import { useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import EditorLayout from '@/layouts/EditorLayout';
import { usePresentationStore } from '@/stores/presentation';
import { useSettingsStore } from '@/stores/settings';
import { useUIStore } from '@/stores/ui';
import AIGenerateModal from '@/components/AIGenerateModal';
import ExportModal from '@/components/ExportModal';
import { useI18n } from '@/i18n';

export default function EditorPage() {
  const { t } = useI18n();
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const loadPresentation = usePresentationStore((s) => s.loadPresentation);
  const presentation = usePresentationStore((s) => s.presentation);
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const showAIGenerateModal = useUIStore((s) => s.showAIGenerateModal);
  const setAIGenerateModal = useUIStore((s) => s.setAIGenerateModal);
  const showExportModal = useUIStore((s) => s.showExportModal);
  const hasOpenedAIGenerateRef = useRef(false);

  useEffect(() => {
    loadSettings();
    if (id) {
      // 如果 store 中已经存在相同 id 的文稿（通常是从主页新建 / 演示列表跳转过来，
      // createPresentation 已经把最新数据放入 store），就不要从后端重新加载——
      // 否则会覆盖前端内存中刚刚通过 setZoom 等操作调整好的临时状态（如缩放比例）。
      // 如果是 F5 刷新（store 空）或切换到其他文稿（id 不同），则正常加载。
      if (!presentation || presentation.id !== id) {
        loadPresentation(id);
      }
    }
  }, [id, loadPresentation, loadSettings, presentation]);

  useEffect(() => {
    if (
      searchParams.get('ai') === '1' &&
      presentation &&
      !showAIGenerateModal &&
      !hasOpenedAIGenerateRef.current
    ) {
      hasOpenedAIGenerateRef.current = true;
      setAIGenerateModal(true);
    }
  }, [searchParams, presentation, showAIGenerateModal, setAIGenerateModal]);

  const handleCloseAIGenerate = () => {
    setAIGenerateModal(false);
    if (searchParams.has('ai')) {
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('ai');
      setSearchParams(newParams, { replace: true });
    }
  };

  if (!presentation) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-600 dark:text-slate-400">{t('加载中...')}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <EditorLayout />
      <AIGenerateModal open={showAIGenerateModal} onClose={handleCloseAIGenerate} />
      {showExportModal && <ExportModal />}
    </>
  );
}
