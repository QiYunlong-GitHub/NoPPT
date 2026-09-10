import { useState } from 'react';
import { type SectionId } from '@/components/settings/constants';
import SettingsHeader from '@/components/settings/SettingsHeader';
import SettingsSidebar from '@/components/settings/SettingsSidebar';
import AIModelSettings from '@/components/settings/AIModelSettings';
import InterfaceSettings from '@/components/settings/InterfaceSettings';
import ExportSettings from '@/components/settings/ExportSettings';
import EditorSettings from '@/components/settings/EditorSettings';
import LogSettings from '@/components/settings/LogSettings';
import DataManagementSettings from '@/components/settings/DataManagementSettings';
import AboutSettings from '@/components/settings/AboutSettings';
import ConfirmModal from '@/components/settings/ConfirmModal';
import { useSettings } from '@/components/settings/useSettings';
import { useTestConnection } from '@/components/settings/useTestConnection';
import { useConfirmDialogs } from '@/components/settings/useConfirmDialogs';
import { useI18n } from '@/i18n';

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState<SectionId>('ai-model');
  const { t } = useI18n();
  const { hasUnsavedChanges, handleSave } = useSettings();
  const { testing, testResult, testConnection } = useTestConnection();
  const {
    showResetConfirm,
    setShowResetConfirm,
    showClearConfirm,
    setShowClearConfirm,
    handleReset,
    handleClearPresentations,
  } = useConfirmDialogs();

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <SettingsHeader onSave={handleSave} hasUnsavedChanges={hasUnsavedChanges} />

      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex gap-8">
          <SettingsSidebar activeSection={activeSection} onSectionChange={setActiveSection} />

          <main className="flex-1 min-w-0 space-y-6">
            {activeSection === 'ai-model' && (
              <AIModelSettings
                onTestConnection={testConnection}
                testing={testing}
                testResult={testResult}
              />
            )}

            {activeSection === 'interface' && <InterfaceSettings />}

            {activeSection === 'export' && <ExportSettings />}

            {activeSection === 'editor' && <EditorSettings />}

            {activeSection === 'logs' && <LogSettings />}

            {activeSection === 'data' && (
              <DataManagementSettings
                onShowResetConfirm={() => setShowResetConfirm(true)}
                onShowClearConfirm={() => setShowClearConfirm(true)}
              />
            )}

            {activeSection === 'about' && <AboutSettings />}
          </main>
        </div>
      </div>

      <ConfirmModal
        isOpen={showResetConfirm}
        onClose={() => setShowResetConfirm(false)}
        onConfirm={handleReset}
        title={t('确认重置设置？')}
        description={t('所有设置将恢复为默认值，但您的演示文稿数据不会被删除。此操作不可撤销。')}
        confirmText={t('确认重置')}
        confirmVariant="warning"
      />

      <ConfirmModal
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={handleClearPresentations}
        title={t('⚠️ 确认清空所有演示数据？')}
        description={
          <>
            {t('这将删除所有演示文稿，')}
            <strong className="text-red-600 dark:text-red-400">{t('不会影响配置设置')}</strong>
            {t('，')}
            <strong className="text-red-600 dark:text-red-400">{t('此操作不可撤销')}</strong>
            {t('。建议先导出演示数据备份。')}
          </>
        }
        confirmText={t('确认清空演示')}
        confirmVariant="danger"
      />
    </div>
  );
}
