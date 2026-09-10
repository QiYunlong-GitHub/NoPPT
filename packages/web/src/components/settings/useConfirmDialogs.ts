import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettingsStore, useUIStore, usePresentationStore } from '@/stores';

export function useConfirmDialogs() {
  const settings = useSettingsStore();
  const showToast = useUIStore((s) => s.showToast);
  const presentations = usePresentationStore();
  const navigate = useNavigate();

  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const handleReset = () => {
    settings.resetSettings();
    setShowResetConfirm(false);
    showToast('设置已重置为默认值', 'success');
  };

  const handleClearPresentations = async () => {
    await presentations.clearAllPresentations();
    setShowClearConfirm(false);
    showToast('所有演示数据已清空', 'success');
    navigate('/');
  };

  return {
    showResetConfirm,
    setShowResetConfirm,
    showClearConfirm,
    setShowClearConfirm,
    handleReset,
    handleClearPresentations,
  };
}
