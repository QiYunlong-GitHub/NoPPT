import { useSettingsStore } from '@/stores/settings';
import type { LogVerbosity } from '@/stores/settings';
import { FileText, Terminal } from 'lucide-react';
import { useI18n, t } from '@/i18n';
const consoleOptions: Array<{
  value: LogVerbosity;
  label: string;
  desc: string;
}> = [
  { value: 'detailed', label: t('详细模式'), desc: t('输出完整的请求/响应报文，用于排查问题') },
  { value: 'simple', label: t('简单模式'), desc: t('仅显示基础状态信息，如开始生成、生成图片等') },
];
const fileOptions: Array<{
  value: LogVerbosity;
  label: string;
  desc: string;
}> = [
  {
    value: 'detailed',
    label: t('详细模式'),
    desc: t('记录配置参数、请求报文、响应报文、后处理结果'),
  },
  { value: 'simple', label: t('简单模式'), desc: t('仅记录基础信息和摘要，节省磁盘空间') },
];
export default function LogSettings() {
  const settings = useSettingsStore();
  const { t } = useI18n();
  const SegmentedControl = ({
    value,
    onChange,
    options,
  }: {
    value: LogVerbosity;
    onChange: (v: LogVerbosity) => void;
    options: Array<{
      value: LogVerbosity;
      label: string;
      desc: string;
    }>;
  }) => (
    <div className="space-y-2">
      <div className="inline-flex rounded-xl border border-slate-200 dark:border-slate-600 overflow-hidden bg-slate-50 dark:bg-slate-700/50 p-1">
        {options.map((opt) => {
          const active = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={`px-5 py-2 text-sm font-medium rounded-lg transition-all ${
                active
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-600/50'
              }`}
            >
              {t(opt.label)}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
        {t(options.find((o) => o.value === value)?.desc ?? '')}
      </p>
    </div>
  );
  return (
    <section className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
      <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t('日志配置')}</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          {t('控制控制台输出详细程度和日志文件记录内容，方便排查 AI 生成演示的问题')}
        </p>
      </div>

      <div className="p-6 space-y-8">
        {/* 控制台输出 */}
        <div>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center">
              <Terminal className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white">
                {t('控制台输出')}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('控制浏览器/终端控制台的日志详细程度')}
              </p>
            </div>
          </div>
          <SegmentedControl
            value={settings.logSettings.consoleVerbosity}
            onChange={(v) => settings.updateLogSettings({ consoleVerbosity: v })}
            options={consoleOptions}
          />
        </div>

        <div className="border-t border-slate-100 dark:border-slate-700" />

        {/* 日志记录 */}
        <div>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 flex items-center justify-center">
              <FileText className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white">
                {t('日志记录（文件）')}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('控制写入 ai-log.jsonl 的内容详细程度')}
              </p>
            </div>
          </div>
          <SegmentedControl
            value={settings.logSettings.fileVerbosity}
            onChange={(v) => settings.updateLogSettings({ fileVerbosity: v })}
            options={fileOptions}
          />
        </div>

        {/* 使用提示 */}
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-300 mb-1">
            {t('💡')}
            {t('使用建议')}
          </p>
          <ul className="text-xs text-amber-700 dark:text-amber-400 space-y-1.5 leading-relaxed list-disc list-inside">
            <li>{t('日常使用推荐"简单模式"，避免信息过载和日志文件过大')}</li>
            <li>{t('遇到生成异常（如图片缺失、内容错误）时切换为"详细模式"复现问题')}</li>
            <li>{t('详细模式下日志可能包含演示内容，请谨慎分享给他人')}</li>
          </ul>
        </div>
      </div>
    </section>
  );
}
