import { useSettingsStore } from '@/stores/settings';
import { slideSizePresets } from './constants';
import { useI18n } from '@/i18n';

export default function EditorSettings() {
  const settings = useSettingsStore();
  const { t } = useI18n();

  return (
    <section className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
      <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t('编辑器设置')}</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          {t('调整编辑器的工作方式')}
        </p>
      </div>
      <div className="p-6 space-y-6">
        {/* 自动保存 */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-white">{t('自动保存')}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('定期自动保存您的工作')}
            </p>
          </div>
          <button
            onClick={() =>
              settings.updateEditorSettings({
                autoSave: !settings.editorSettings.autoSave,
              })
            }
            className={`relative w-12 h-7 rounded-full transition-colors ${
              settings.editorSettings.autoSave ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600'
            }`}
          >
            <span
              className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                settings.editorSettings.autoSave ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {/* 自动保存间隔 */}
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
            {t('自动保存间隔: {n} 秒', { n: settings.editorSettings.autoSaveInterval / 1000 })}
          </label>
          <input
            type="range"
            min="10000"
            max="120000"
            step="10000"
            value={settings.editorSettings.autoSaveInterval}
            onChange={(e) =>
              settings.updateEditorSettings({
                autoSaveInterval: Number(e.target.value),
              })
            }
            disabled={!settings.editorSettings.autoSave}
            className="w-full max-w-md h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-600 disabled:opacity-50"
          />
        </div>

        {/* 撤销历史 */}
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
            {t('撤销历史限制: {n} 步', { n: settings.editorSettings.undoHistoryLimit })}
          </label>
          <input
            type="range"
            min="10"
            max="200"
            step="10"
            value={settings.editorSettings.undoHistoryLimit}
            onChange={(e) =>
              settings.updateEditorSettings({
                undoHistoryLimit: Number(e.target.value),
              })
            }
            className="w-full max-w-md h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
          />
        </div>

        {/* 卡片尺寸 */}
        <div className="pt-2">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
            {t('默认卡片尺寸')}
          </label>
          <div className="flex gap-4 items-center">
            <div className="flex-1">
              <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">
                {t('宽度 (px)')}
              </label>
              <input
                type="number"
                value={settings.editorSettings.defaultSlideWidth}
                onChange={(e) =>
                  settings.updateEditorSettings({
                    defaultSlideWidth: Number(e.target.value),
                  })
                }
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg font-mono text-sm"
              />
            </div>
            <span className="text-slate-400 dark:text-slate-500 pt-5">×</span>
            <div className="flex-1">
              <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">
                {t('高度 (px)')}
              </label>
              <input
                type="number"
                value={settings.editorSettings.defaultSlideHeight}
                onChange={(e) =>
                  settings.updateEditorSettings({
                    defaultSlideHeight: Number(e.target.value),
                  })
                }
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg font-mono text-sm"
              />
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            {slideSizePresets.map((preset) => {
              const isActive =
                settings.editorSettings.defaultSlideWidth === preset.w &&
                settings.editorSettings.defaultSlideHeight === preset.h;
              return (
                <button
                  key={preset.label}
                  onClick={() =>
                    settings.updateEditorSettings({
                      defaultSlideWidth: preset.w,
                      defaultSlideHeight: preset.h,
                    })
                  }
                  className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                    isActive
                      ? 'bg-blue-500 text-white border-blue-500'
                      : 'border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
