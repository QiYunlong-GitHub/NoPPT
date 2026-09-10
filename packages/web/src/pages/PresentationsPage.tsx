import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText,
  Trash2,
  Edit3,
  ArrowLeft,
  Settings,
  Layout,
  Clock,
  MoreVertical,
} from 'lucide-react';
import { usePresentationStore } from '@/stores/presentation';
import { useUIStore } from '@/stores/ui';
import type { PresentationListItem } from '@/utils/api';
import { presentationApi } from '@/utils/api';
import { useI18n, t } from '@/i18n';
export default function PresentationsPage() {
  const navigate = useNavigate();
  const loadAllPresentations = usePresentationStore((s) => s.loadAllPresentations);
  const deletePresentation = usePresentationStore((s) => s.deletePresentation);
  const presentations = usePresentationStore((s) => s.presentations);
  const showToast = useUIStore((s) => s.showToast);
  const { t } = useI18n();
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  useEffect(() => {
    loadAllPresentations();
  }, [loadAllPresentations]);
  useEffect(() => {
    const handleClickOutside = () => {
      setMenuOpenId(null);
    };
    if (menuOpenId) {
      window.addEventListener('click', handleClickOutside);
      return () => window.removeEventListener('click', handleClickOutside);
    }
  }, [menuOpenId]);
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
  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800">
      {/* Header */}
      <header className="border-b border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/')}
              className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
              title={t('返回首页')}
            >
              <ArrowLeft className="w-5 h-5 text-slate-600 dark:text-slate-400" />
              title={t('返回首页')}
            </button>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                <Layout className="w-5 h-5 text-white" />
              </div>
              <span className="font-bold text-xl text-slate-800 dark:text-slate-100">
                {t('所有演示')}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/settings')}
              className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
            >
              <Settings className="w-5 h-5 text-slate-600 dark:text-slate-400" />
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-6 py-8">
        {presentations.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-20 h-20 mx-auto mb-6 bg-slate-100 dark:bg-slate-800 rounded-2xl flex items-center justify-center">
              <FileText className="w-10 h-10 text-slate-400" />
            </div>
            <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-300 mb-2">
              {t('还没有演示文稿')}
            </h3>
            <p className="text-slate-500 dark:text-slate-400 mb-6">
              {t('创建你的第一个演示文稿吧')}
            </p>
            <button
              onClick={() => navigate('/')}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-900 dark:bg-slate-700 text-white rounded-lg hover:bg-slate-800 dark:hover:bg-slate-600 transition-colors font-medium"
            >
              {t('返回首页创建')}
            </button>
          </div>
        ) : (
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
            {/* Table header */}
            <div className="px-6 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
              <div className="grid grid-cols-12 gap-4 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                <div className="col-span-7">{t('名称')}</div>
                <div className="col-span-3 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  {t('编辑时间')}
                </div>
                <div className="col-span-2 text-right">{t('操作')}</div>
              </div>
            </div>

            {/* Table body */}
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {presentations.map((pres, index) => {
                const isBottom = index === presentations.length - 1;
                return (
                  <div
                    key={pres.id}
                    className="px-6 py-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group"
                  >
                    <div className="grid grid-cols-12 gap-4 items-center">
                      {/* Name */}
                      <div className="col-span-7 flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-700 dark:to-slate-800 rounded-lg flex items-center justify-center flex-shrink-0">
                          <FileText className="w-5 h-5 text-slate-400" />
                        </div>
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
                            className="flex-1 bg-slate-50 dark:bg-slate-800 border border-blue-400 rounded px-2 py-1.5 text-sm text-slate-700 dark:text-slate-300 outline-none min-w-0"
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <button
                            onClick={() => openPresentation(pres.id)}
                            className="flex-1 text-left font-medium text-slate-800 dark:text-slate-200 hover:text-blue-600 dark:hover:text-blue-400 truncate min-w-0"
                            title={pres.title}
                          >
                            {pres.title}
                          </button>
                        )}
                      </div>

                      {/* Date */}
                      <div className="col-span-3 text-sm text-slate-500 dark:text-slate-400">
                        {formatDate(pres.updatedAt)}
                      </div>

                      {/* Actions */}
                      <div className="col-span-2 flex items-center justify-end gap-2 relative">
                        <button
                          onClick={() => openPresentation(pres.id)}
                          className="px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-md transition-colors font-medium"
                        >
                          {t('编辑')}
                        </button>

                        <div className="relative">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenuOpenId(menuOpenId === pres.id ? null : pres.id);
                            }}
                            className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                          >
                            <MoreVertical className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                          </button>

                          {menuOpenId === pres.id && (
                            <div
                              className="absolute right-0 top-full mt-1 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 py-1 z-20 min-w-[120px]"
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
                                onClick={(e) => handleDelete(pres.id, e)}
                                className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2"
                              >
                                <Trash2 className="w-4 h-4" />
                                {t('删除')}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
