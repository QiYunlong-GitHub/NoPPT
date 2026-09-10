import { useState, useEffect, useRef } from 'react';
import { useSettingsStore, useUIStore } from '@/stores';

export function useSettings() {
  const settings = useSettingsStore();
  const showToast = useUIStore((s) => s.showToast);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const isInitialLoad = useRef(true);

  useEffect(() => {
    settings.loadSettings();
    setTimeout(() => {
      isInitialLoad.current = false;
    }, 100);
  }, []);

  useEffect(() => {
    const unsubscribe = useSettingsStore.subscribe(() => {
      if (!isInitialLoad.current) {
        setHasUnsavedChanges(true);
      }
    });
    return unsubscribe;
  }, []);

  const handleSave = async () => {
    try {
      await settings.saveSettings();
      setHasUnsavedChanges(false);
      showToast('设置已保存到配置文件', 'success');
    } catch {
      showToast('保存失败，请重试', 'error');
    }
  };

  return {
    settings,
    showToast,
    hasUnsavedChanges,
    handleSave,
  };
}
