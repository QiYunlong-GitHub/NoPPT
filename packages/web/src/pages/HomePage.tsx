import { useNavigate } from 'react-router-dom';
import {
  Plus,
  FileText,
  Settings,
  Sparkles,
  Layout,
  Zap,
  Lock,
  Trash2,
  Edit3,
  MoreVertical,
  ChevronRight,
  RefreshCw,
  ExternalLink,
  Copy,
} from 'lucide-react';
import { usePresentationStore } from '@/stores/presentation';
import { useSettingsStore } from '@/stores/settings';
import { useUIStore, prefillFromDraft } from '@/stores/ui';
import { useEffect, useRef, useState } from 'react';
import type { PresentationListItem } from '@/utils/api';
import { presentationApi, draftApi, DraftFetchError } from '@/utils/api';
import { useI18n, t } from '@/i18n';
export default function HomePage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const createPresentation = usePresentationStore((s) => s.createPresentation);
  const deletePresentation = usePresentationStore((s) => s.deletePresentation);
  const loadAllPresentations = usePresentationStore((s) => s.loadAllPresentations);
  const presentations = usePresentationStore((s) => s.presentations);
  const editorSettings = useSettingsStore((s) => s.editorSettings);
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const updatePresentation = usePresentationStore((s) => s.updatePresentation);
  const showToast = useUIStore((s) => s.showToast);
  const setAIPrefill = useUIStore((s) => s.setAIPrefill);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  /** 已处理过的草稿深链（防重复拉取 / 重复建演示）。 */
  const handledDraftRef = useRef<string | null>(null);
  useEffect(() => {
    loadSettings();
    loadAllPresentations();
  }, [loadSettings, loadAllPresentations]);
  /**
   * 深链入口：`/?ai=1&draft=<id>&t=<tenant>&u=<user>&token=<sig>`
   *
   * Hermes 备料后回给用户的链接。此处只做三件事：
   * 1) 凭签名 token 拉取草稿；2) 建一份空演示承载成片；3) 把预填暂存进 ui store。
   * 随后跳 `/editor/:id?ai=1`，由 EditorPage 唤起配置弹窗并停在 config 等用户确认。
   * 失败一律 toast 并留在首页，**不创建空演示**。
   */
  // 依赖里只放稳定引用会很难（navigate / store action 的引用可能变化），
  // 这里用 ref 持有最新 handler，effect 只在挂载时跑一次，避免异步过程中被 cleanup 取消。
  const handlersRef = useRef({ createPresentation, navigate, setAIPrefill, showToast });
  handlersRef.current = { createPresentation, navigate, setAIPrefill, showToast };
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const draftId = params.get('draft');
    if (!draftId) return;
    if (handledDraftRef.current === draftId) return;
    // sessionStorage 兜底：刷新/回退回到首页时组件重新挂载，ref 会丢，避免重复建演示。
    if (sessionStorage.getItem(`noppt:handled-draft:${draftId}`)) return;
    handledDraftRef.current = draftId;
    sessionStorage.setItem(`noppt:handled-draft:${draftId}`, '1');
    void (async () => {
      const { createPresentation, navigate, setAIPrefill, showToast } = handlersRef.current;
      try {
        const draft = await draftApi.get(
          draftId,
          params.get('t') ?? '',
          params.get('u') ?? '',
          params.get('token') ?? '',
        );
        const { editorSettings } = useSettingsStore.getState();
        const pres = await createPresentation(
          draft.topic?.trim() || t('AI生成演示'),
          editorSettings?.defaultSlideWidth,
          editorSettings?.defaultSlideHeight,
        );
        setAIPrefill(prefillFromDraft(draft));
        // 先抹掉 URL 上的草稿参数（用 history 而非 router，避免与下面的 navigate 竞争），
        // 再跳编辑器；EditorPage 见 ai=1 会唤起配置弹窗。
        window.history.replaceState({}, '', window.location.pathname);
        navigate(`/editor/${pres.id}?ai=1`);
      } catch (err) {
        console.error(t('深链草稿读取失败:'), err);
        const message =
          err instanceof DraftFetchError
            ? (
                {
                  expired: t('该生成链接已过期，请让助手重新生成一条'),
                  not_found: t('未找到该生成草稿，请让助手重新生成一条链接'),
                  forbidden: t('生成链接无效或无访问权限'),
                  unknown: err.message,
                } as Record<DraftFetchError['kind'], string>
              )[err.kind]
            : t('生成草稿读取失败，请让助手重新生成一条链接');
        showToast(message, 'error');
      }
    })();
    // 仅在挂载时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const handleClickOutside = () => {
      setMenuOpenId(null);
    };
    if (menuOpenId) {
      window.addEventListener('click', handleClickOutside);
      return () => window.removeEventListener('click', handleClickOutside);
    }
  }, [menuOpenId]);
  const handleCreateNew = async () => {
    if (isCreating) return;
    setIsCreating(true);
    try {
      const pres = await createPresentation(
        t('新演示文稿'),
        editorSettings.defaultSlideWidth,
        editorSettings.defaultSlideHeight,
      );
      navigate(`/editor/${pres.id}`);
    } finally {
      setIsCreating(false);
    }
  };
  const handleCreateAI = async () => {
    if (isCreating) return;
    setIsCreating(true);
    try {
      const pres = await createPresentation(
        t('AI生成演示'),
        editorSettings.defaultSlideWidth,
        editorSettings.defaultSlideHeight,
      );
      navigate(`/editor/${pres.id}?ai=1`);
    } finally {
      setIsCreating(false);
    }
  };
  const openPresentation = (id: string) => {
    navigate(`/editor/${id}`);
  };
  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(t('确定要删除这个演示文稿吗？此操作不可撤销。'))) {
      await deletePresentation(id);
      setMenuOpenId(null);
    }
  };
  const handleDuplicate = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      // 改用后端内部复制接口（POST /:id/duplicate），避免前端发送大 body
      await presentationApi.duplicate(id);
      await loadAllPresentations();
      setMenuOpenId(null);
    } catch (err) {
      console.error('Failed to duplicate presentation:', err);
    }
  };
  const handleStartRename = (pres: PresentationListItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(pres.id);
    setEditTitle(pres.title);
    setMenuOpenId(null);
  };
  const handleSaveRename = async (id: string) => {
    const newTitle = editTitle.trim() || t('未命名演示');
    try {
      // 改用轻量 PATCH 接口：只发送标题，不发送整个 slides body
      await presentationApi.updateMeta(id, { title: newTitle });
      // 如果当前在编辑器中打开了这个演示，也更新store中的状态（不标记为未保存，因为已经保存到后端了）
      const store = usePresentationStore.getState();
      if (store.presentation && store.presentation.id === id) {
        store.updatePresentation({ title: newTitle }, false);
      }
      // 重新加载列表以显示最新数据
      await loadAllPresentations();
      showToast(t('重命名成功'), 'success');
    } catch (err) {
      console.error('Failed to rename presentation:', err);
      showToast(t('重命名失败，请重试'), 'error');
    }
    setEditingId(null);
  };
  const recentPresentations = presentations.slice(0, 5);
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800">
      {/* Header */}
      <header className="border-b border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/NoPPT.ico" alt="NoPPT" className="w-8 h-8 rounded-lg" />
            <span className="font-bold text-xl text-slate-800 dark:text-slate-100">NoPPT</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="relative group">
              <button
                onClick={() => navigate('/settings')}
                className="p-2.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
              >
                <Settings className="w-6 h-6 text-slate-600 dark:text-slate-400" />
              </button>
              <div className="absolute top-full right-0 mt-2 px-2 py-1 bg-slate-800 dark:bg-slate-700 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-20">
                {t('配置')}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-4xl mx-auto px-6 py-16 text-center">
        <h1 className="text-4xl md:text-5xl font-bold text-slate-900 dark:text-white mb-4">
          {t('用 AI 快速创建')}
          <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            {' '}
            {t('专业演示文稿')}
          </span>
        </h1>
        <p className="text-lg text-slate-600 dark:text-slate-400 mb-8 max-w-2xl mx-auto">
          {t(
            '开源、高性能、可私有化部署的卡片式演示平台。一句话生成完整演示，拖拽微调，一键导出。',
          )}
        </p>
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={handleCreateNew}
            disabled={isCreating}
            className="inline-flex items-center gap-2 px-6 py-3 bg-slate-900 dark:bg-slate-700 text-white rounded-xl hover:bg-slate-800 dark:hover:bg-slate-600 transition-colors font-medium disabled:opacity-50"
          >
            <Plus className="w-5 h-5" />
            {t('新建空白演示')}
          </button>
          <button
            onClick={handleCreateAI}
            disabled={isCreating}
            className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-xl hover:opacity-90 transition-opacity font-medium disabled:opacity-50"
          >
            <Sparkles className="w-5 h-5" />
            {t('AI 生成演示')}
          </button>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-5xl mx-auto px-6 pb-16">
        <div className="grid md:grid-cols-3 gap-6">
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-sm border border-slate-100 dark:border-slate-700">
            <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center mb-4">
              <Zap className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
            <h3 className="font-semibold text-slate-900 dark:text-white mb-2">{t('极速体验')}</h3>
            <p className="text-slate-600 dark:text-slate-400 text-sm">
              {t('高性能渲染引擎，虚拟滚动技术，30+ 卡片依然流畅运行，丝滑编辑体验。')}
            </p>
          </div>
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-sm border border-slate-100 dark:border-slate-700">
            <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-xl flex items-center justify-center mb-4">
              <Lock className="w-6 h-6 text-green-600 dark:text-green-400" />
            </div>
            <h3 className="font-semibold text-slate-900 dark:text-white mb-2">{t('数据安全')}</h3>
            <p className="text-slate-600 dark:text-slate-400 text-sm">
              {t('支持完全私有化部署，本地优先策略，敏感数据不出域，代码开源可审计。')}
            </p>
          </div>
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-sm border border-slate-100 dark:border-slate-700">
            <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/30 rounded-xl flex items-center justify-center mb-4">
              <Layout className="w-6 h-6 text-purple-600 dark:text-purple-400" />
            </div>
            <h3 className="font-semibold text-slate-900 dark:text-white mb-2">{t('灵活设计')}</h3>
            <p className="text-slate-600 dark:text-slate-400 text-sm">
              {t('无界卡片布局，可视化拖拽编辑，丰富的模板库，一键切换主题风格。')}
            </p>
          </div>
        </div>
      </section>

      {/* Recent */}
      {recentPresentations.length > 0 && (
        <section className="max-w-6xl mx-auto px-6 pb-16">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
              {t('最近编辑')}
            </h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => loadAllPresentations()}
                className="inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 font-medium p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                title={t('刷新列表')}
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              <button
                onClick={() => navigate('/presentations')}
                className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                {t('所有演示')}
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {recentPresentations.map((pres) => (
              <div key={pres.id} className="group relative text-left">
                <button onClick={() => openPresentation(pres.id)} className="w-full text-left">
                  <div className="aspect-video bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden group-hover:shadow-md group-hover:border-blue-300 dark:group-hover:border-blue-500 transition-all">
                    <div className="h-full flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-800 dark:to-slate-900">
                      <FileText className="w-12 h-12 text-slate-400" />
                    </div>
                  </div>
                </button>

                {/* More menu button */}
                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      window.open(`/editor/${pres.id}`, '_blank');
                    }}
                    className="p-1.5 bg-white/90 dark:bg-slate-800/90 rounded-lg hover:bg-white dark:hover:bg-slate-700 shadow-sm border border-slate-200 dark:border-slate-700 transition-all"
                    title={t('在新标签页打开')}
                  >
                    <ExternalLink className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpenId(menuOpenId === pres.id ? null : pres.id);
                    }}
                    className="p-1.5 bg-white/90 dark:bg-slate-800/90 rounded-lg hover:bg-white dark:hover:bg-slate-700 shadow-sm border border-slate-200 dark:border-slate-700 transition-all"
                    title={t('更多操作')}
                  >
                    <MoreVertical className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                  </button>
                </div>

                {/* Dropdown menu */}
                {menuOpenId === pres.id && (
                  <div
                    className="absolute top-10 right-2 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 py-1 z-20 min-w-[120px]"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={(e) => handleStartRename(pres, e)}
                      className="w-full px-3 py-2 text-left text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 flex items-center gap-2"
                    >
                      <Edit3 className="w-4 h-4" />
                      {t('重命名')}
                    </button>
                    <button
                      onClick={(e) => handleDuplicate(pres.id, e)}
                      className="w-full px-3 py-2 text-left text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 flex items-center gap-2"
                    >
                      <Copy className="w-4 h-4" />
                      {t('复制')}
                    </button>
                    <button
                      onClick={(e) => handleDelete(pres.id, e)}
                      className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2"
                    >
                      <Trash2 className="w-4 h-4" />
                      {t('删除')}
                    </button>
                  </div>
                )}

                {/* Title */}
                {editingId === pres.id ? (
                  <input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onBlur={() => handleSaveRename(pres.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveRename(pres.id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    autoFocus
                    className="mt-2 text-sm font-medium text-slate-700 dark:text-slate-300 w-full bg-slate-50 dark:bg-slate-800 border border-blue-400 rounded px-2 py-1 outline-none"
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <p className="mt-2 text-sm font-medium text-slate-700 dark:text-slate-300 truncate">
                    {pres.title}
                  </p>
                )}
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {new Date(pres.updatedAt).toLocaleDateString()}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <div className="max-w-6xl mx-auto px-6 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
          <p>{t('NoPPT - 开源卡片式演示平台 · MIT License')}</p>
        </div>
      </footer>
    </div>
  );
}
