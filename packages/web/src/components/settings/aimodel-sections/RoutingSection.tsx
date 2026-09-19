import { t } from '@/i18n';
import { Sparkles, HelpCircle, Info } from 'lucide-react';
import { getRoutingStages } from '../routingStages';
import type { AIModelHandlers } from './types';

interface RoutingSectionProps {
  handlers: AIModelHandlers;
  showRoutingHelp: string | null;
  setShowRoutingHelp: (key: string | null) => void;
}

export function RoutingSection({
  handlers,
  showRoutingHelp,
  setShowRoutingHelp,
}: RoutingSectionProps) {
  const { getRoutingValue, handleRoutingChange, buildModelOptions } = handlers;
  const routingStages = getRoutingStages();
  const modelOptions = buildModelOptions();
  return (
    <section className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
      <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          {t('模型路由设置')}
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          {t('为不同生成阶段指定使用的模型，充分利用各模型的能力特点')}
        </p>
      </div>
      <div className="p-6 space-y-5">
        <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-700/50">
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider w-40">
                  {t('任务阶段')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  {t('使用模型')}
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {routingStages.map((stage) => {
                const Icon = stage.icon;
                const currentValue = getRoutingValue(stage.key);
                return (
                  <tr key={stage.key} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2.5">
                        <div className="p-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                          <Icon className="w-4 h-4" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-900 dark:text-white">
                            {stage.name}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {stage.desc}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <select
                        value={currentValue}
                        onChange={(e) => handleRoutingChange(stage.key, e.target.value)}
                        className="w-full max-w-md px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                      >
                        {modelOptions.map((opt) => (
                          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                            {opt.label}
                            {opt.disabled ? ` (${opt.disabledReason})` : ''}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 flex items-center gap-1">
                        <Sparkles className="w-3 h-3" />
                        {stage.recommendation}
                      </p>
                    </td>
                    <td className="px-4 py-4 text-center">
                      <div className="relative">
                        <button
                          onPointerEnter={() => setShowRoutingHelp(stage.key)}
                          onPointerLeave={() => setShowRoutingHelp(null)}
                          className="p-1.5 text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-full transition-colors"
                          title={t('了解详情')}
                        >
                          <HelpCircle className="w-4 h-4" />
                        </button>
                        {showRoutingHelp === stage.key && (
                          <div className="absolute right-0 top-full mt-2 w-64 p-3 bg-slate-800 dark:bg-slate-700 text-white text-xs rounded-lg shadow-xl z-20 text-left leading-relaxed">
                            {stage.tip}
                            <div className="absolute -top-1.5 right-3 w-3 h-3 bg-slate-800 dark:bg-slate-700 rotate-45"></div>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
          <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-blue-800 dark:text-blue-300 leading-relaxed">
            {t(
              '下拉列表显示所有已配置API Key的提供商下的模型。灰色选项表示该提供商尚未配置API Key，请先在上方完成配置。图片生成使用下方独立的图片模型配置。',
            )}
          </p>
        </div>
      </div>
    </section>
  );
}
