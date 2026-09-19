import { t } from '@/i18n';
import { Route, Image, FileText, Layers, HelpCircle } from 'lucide-react';
import type { AIModelSettingsStore, AIModelHandlers } from './types';

export function ImageRoutingConfig({
  settings,
  activeImageProvider,
  showRoutingHelp,
  setShowRoutingHelp,
}: {
  settings: AIModelSettingsStore;
  activeImageProvider: AIModelHandlers['activeImageProvider'];
  showRoutingHelp: string | null;
  setShowRoutingHelp: (key: string | null) => void;
}) {
  return (
    <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-900/10 rounded-lg border border-blue-200 dark:border-blue-800">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Route className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('图片模型路由')}
          </label>
          <button
            onClick={() => setShowRoutingHelp(showRoutingHelp === 'image' ? null : 'image')}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
            title={t('了解图片模型路由')}
          >
            <HelpCircle className="w-3.5 h-3.5" />
          </button>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            className="sr-only peer"
            checked={
              settings.imageGeneration.routing[settings.imageGeneration.activeProvider]?.enabled ||
              false
            }
            onChange={(e) =>
              settings.setImageRoutingConfig(settings.imageGeneration.activeProvider, {
                enabled: e.target.checked,
              })
            }
          />
          <div className="w-9 h-5 bg-slate-300 dark:bg-slate-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
        </label>
      </div>

      {showRoutingHelp === 'image' && (
        <div className="mb-3 p-3 bg-blue-100 dark:bg-blue-900/20 rounded text-xs text-slate-600 dark:text-slate-400 space-y-1.5">
          <p className="font-medium text-slate-700 dark:text-slate-300">{t('自动选择策略：')}</p>
          <p>
            1. <strong>{t('能力过滤')}</strong>
            {t('：先筛选支持目标图片比例和像素范围的模型')}
          </p>
          <p>
            2. <strong>{t('版本优先')}</strong>
            {t(
              '：高版本基础模型优于低版本增强模型（如 qwen-image-2.0 优于 qwen-image-plus）',
            )}
          </p>
          <p>
            3. <strong>{t('场景适配')}</strong>
            {t('：封面用最高质量模型，次要页用最快模型，内容页平衡质量与速度')}
          </p>
          <p className="mt-2 text-blue-600 dark:text-blue-400">
            {t('选择"自动选择"时使用上述策略，也可以手动为每种页面类型指定固定模型。')}
          </p>
        </div>
      )}

      {settings.imageGeneration.routing[settings.imageGeneration.activeProvider]?.enabled && (
        <div className="space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 dark:text-slate-400 border-b border-blue-200 dark:border-blue-800">
                  <th className="text-left py-2 pr-3 font-medium w-28">{t('页面类型')}</th>
                  <th className="text-left py-2 px-3 font-medium">{t('使用模型')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-blue-100 dark:divide-blue-900/30">
                {[
                  {
                    key: 'cover' as const,
                    name: '封面',
                    icon: Image,
                    desc: t('首页封面，优先高质量'),
                  },
                  {
                    key: 'content' as const,
                    name: '内容页',
                    icon: FileText,
                    desc: t('图文内容页，平衡质量与速度'),
                  },
                  {
                    key: 'secondary' as const,
                    name: '次要页',
                    icon: Layers,
                    desc: t('目录/卡片/对比/时间线/表格/总结，优先速度'),
                  },
                ].map(({ key, name, icon: Icon, desc }) => {
                  const routing =
                    settings.imageGeneration.routing[settings.imageGeneration.activeProvider];
                  const currentIndex =
                    routing?.[
                      `${key}ModelIndex` as
                        | 'coverModelIndex'
                        | 'contentModelIndex'
                        | 'secondaryModelIndex'
                    ];
                  const hasManual = currentIndex !== undefined && currentIndex >= 0;
                  return (
                    <tr key={key}>
                      <td className="py-2.5 pr-3">
                        <div className="flex items-center gap-2">
                          <Icon className="w-4 h-4 text-slate-500 dark:text-slate-400 flex-shrink-0" />
                          <div>
                            <div className="font-medium text-slate-700 dark:text-slate-300">
                              {name}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              {desc}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <select
                          className="w-full px-2.5 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          value={hasManual ? String(currentIndex) : 'auto'}
                          onChange={(e) => {
                            const val = e.target.value;
                            const field = `${key}ModelIndex` as
                              | 'coverModelIndex'
                              | 'contentModelIndex'
                              | 'secondaryModelIndex';
                            if (val === 'auto') {
                              settings.setImageRoutingConfig(
                                settings.imageGeneration.activeProvider,
                                { [field]: undefined },
                              );
                            } else {
                              settings.setImageRoutingConfig(
                                settings.imageGeneration.activeProvider,
                                { [field]: parseInt(val, 10) },
                              );
                            }
                          }}
                        >
                          <option value="auto">{t('自动选择（推荐）')}</option>
                          {(activeImageProvider?.models || []).map((m, i) => (
                            <option key={i} value={String(i)}>
                              {m.modelName}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 px-0.5">
            {t(
              '次要页包含：目录、卡片、对比、时间线、表格、总结页。这些页面通常不需要配图，或配图质量要求较低。',
            )}
          </p>
        </div>
      )}

      {!settings.imageGeneration.routing[settings.imageGeneration.activeProvider]?.enabled && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t(
            '启用后将根据页面类型自动选择最合适的图片模型。关闭时所有页面统一使用默认模型（第一个）。',
          )}
        </p>
      )}
    </div>
  );
}
