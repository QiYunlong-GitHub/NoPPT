import { ArrowLeft, Save } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '@/i18n';

interface SettingsHeaderProps {
  onSave: () => void;
  hasUnsavedChanges: boolean;
}

export default function SettingsHeader({ onSave, hasUnsavedChanges }: SettingsHeaderProps) {
  const navigate = useNavigate();
  const { t } = useI18n();

  return (
    <header className="border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center gap-4">
        <button
          onClick={() => navigate(-1)}
          className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-slate-600 dark:text-slate-400" />
        </button>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-white">{t('设置')}</h1>
        <div className="flex-1" />
        <button
          onClick={onSave}
          disabled={!hasUnsavedChanges}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg transition-colors text-sm font-medium ${
            hasUnsavedChanges
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500 cursor-not-allowed'
          }`}
        >
          <Save className="w-4 h-4" />
          {t('保存')}
        </button>
      </div>
    </header>
  );
}
