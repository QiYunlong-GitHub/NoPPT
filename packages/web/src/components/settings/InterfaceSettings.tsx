import { useI18n } from '@/i18n';
import { useSettingsStore } from '@/stores/settings';
import { themeOptions, languageOptions } from './constants';
import type { Locale } from '@/i18n';

export default function InterfaceSettings() {
  const { t, setLocale } = useI18n();
  const settings = useSettingsStore();

  return (
    <section className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
      <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t('界面设置')}</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t('自定义编辑器的外观和行为')}</p>
      </div>
      <div className="p-6 space-y-6">
        {/* 主题 */}
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
            {t('主题模式')}
          </label>
          <div className="grid grid-cols-3 gap-3">
            {themeOptions.map((theme) => {
              const Icon = theme.icon;
              return (
                <button
                  key={theme.value}
                  onClick={() =>
                    settings.updateInterfaceSettings({ theme: theme.value as any })
                  }
                  className={`flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all ${
                    settings.interfaceSettings.theme === theme.value
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400'
                      : 'border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span className="text-sm font-medium">{t(theme.label)}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 语言 */}
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
            {t('界面语言')}
          </label>
          <div className="flex gap-3">
            {languageOptions.map((lang) => {
              const Icon = lang.icon;
              return (
                <button
                  key={lang.value}
                  onClick={() => setLocale(lang.value as Locale)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg border-2 transition-all ${
                    settings.interfaceSettings.language === lang.value
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400'
                      : 'border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="text-sm font-medium">{t(lang.label)}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 默认缩放 */}
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
            {t('默认缩放: {zoom}%', { zoom: settings.interfaceSettings.defaultZoom })}
          </label>
          <input
            type="range"
            min="50"
            max="200"
            step="10"
            value={settings.interfaceSettings.defaultZoom}
            onChange={(e) =>
              settings.updateInterfaceSettings({
                defaultZoom: Number(e.target.value),
              })
            }
            className="w-full max-w-md h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
          />
        </div>

        {/* 网格设置 */}
        <div className="space-y-4 pt-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-slate-100 dark:bg-slate-700 rounded-lg">
                <div className="w-5 h-5 text-slate-500 dark:text-slate-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-900 dark:text-white">{t('显示网格')}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{t('在编辑器画布上显示参考网格')}</p>
              </div>
            </div>
            <button
              onClick={() =>
                settings.updateInterfaceSettings({
                  showGrid: !settings.interfaceSettings.showGrid,
                })
              }
              className={`relative w-12 h-7 rounded-full transition-colors ${
                settings.interfaceSettings.showGrid
                  ? 'bg-blue-600'
                  : 'bg-slate-300 dark:bg-slate-600'
              }`}
            >
              <span
                className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  settings.interfaceSettings.showGrid
                    ? 'translate-x-6'
                    : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-white">{t('吸附对齐网格')}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{t('拖拽元素时自动吸附到网格线')}</p>
            </div>
            <button
              onClick={() =>
                settings.updateInterfaceSettings({
                  snapToGrid: !settings.interfaceSettings.snapToGrid,
                })
              }
              className={`relative w-12 h-7 rounded-full transition-colors ${
                settings.interfaceSettings.snapToGrid
                  ? 'bg-blue-600'
                  : 'bg-slate-300 dark:bg-slate-600'
              }`}
            >
              <span
                className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  settings.interfaceSettings.snapToGrid
                    ? 'translate-x-6'
                    : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
              {t('网格大小: {size}px', { size: settings.interfaceSettings.gridSize })}
            </label>
            <input
              type="range"
              min="10"
              max="50"
              step="5"
              value={settings.interfaceSettings.gridSize}
              onChange={(e) =>
                settings.updateInterfaceSettings({
                  gridSize: Number(e.target.value),
                })
              }
              disabled={!settings.interfaceSettings.showGrid}
              className="w-full max-w-md h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-600 disabled:opacity-50"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
