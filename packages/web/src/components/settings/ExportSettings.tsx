import { useSettingsStore } from '@/stores/settings';
import { exportFormatOptions, pdfQualityOptions } from './constants';
import { useI18n } from '@/i18n';

export default function ExportSettings() {
  const settings = useSettingsStore();
  const { t } = useI18n();

  return (
    <section className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
      <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t('导出设置')}</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          {t('配置导出文件的默认选项')}
        </p>
      </div>
      <div className="p-6 space-y-6">
        {/* 默认格式 */}
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
            {t('默认导出格式')}
          </label>
          <div className="grid grid-cols-3 gap-3">
            {exportFormatOptions.map((fmt) => (
              <button
                key={fmt.value}
                onClick={() => settings.updateExportSettings({ defaultFormat: fmt.value as any })}
                className={`p-4 rounded-lg border-2 text-left transition-all ${
                  settings.exportSettings.defaultFormat === fmt.value
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500'
                }`}
              >
                <p className="font-medium text-slate-900 dark:text-white mb-1">{fmt.label}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{t(fmt.desc)}</p>
              </button>
            ))}
          </div>
        </div>

        {/* PDF 质量 */}
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
            {t('PDF 导出质量')}
          </label>
          <div className="flex gap-3">
            {pdfQualityOptions.map((q) => (
              <button
                key={q.value}
                onClick={() => settings.updateExportSettings({ pdfQuality: q.value as any })}
                className={`flex-1 p-3 rounded-lg border-2 text-center transition-all ${
                  settings.exportSettings.pdfQuality === q.value
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500'
                }`}
              >
                <p className="font-medium text-slate-900 dark:text-white text-sm">{t(q.label)}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t(q.size)}</p>
              </button>
            ))}
          </div>
        </div>

        {/* PNG 缩放 */}
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
            {t('PNG 导出缩放: {n}x', { n: settings.exportSettings.pngScale })}
          </label>
          <input
            type="range"
            min="1"
            max="3"
            step="0.5"
            value={settings.exportSettings.pngScale}
            onChange={(e) =>
              settings.updateExportSettings({
                pngScale: Number(e.target.value),
              })
            }
            className="w-full max-w-md h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
          />
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
            {t('更高的缩放比会产生更清晰的图片，但文件也更大')}
          </p>
        </div>

        {/* 备注 */}
        <div className="flex items-center justify-between pt-2">
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-white">
              {t('包含演讲者备注')}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('导出 PDF 时包含每张卡片的备注内容')}
            </p>
          </div>
          <button
            onClick={() =>
              settings.updateExportSettings({
                includeSpeakerNotes: !settings.exportSettings.includeSpeakerNotes,
              })
            }
            className={`relative w-12 h-7 rounded-full transition-colors ${
              settings.exportSettings.includeSpeakerNotes
                ? 'bg-blue-600'
                : 'bg-slate-300 dark:bg-slate-600'
            }`}
          >
            <span
              className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                settings.exportSettings.includeSpeakerNotes ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>
    </section>
  );
}
