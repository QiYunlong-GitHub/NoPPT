import { t } from '@/i18n';
import { Sparkles, AlertTriangle, FileCode2, Eye, RotateCw, Gauge } from 'lucide-react';
import type { AIModelSettingsStore } from './types';

interface InlineSelfCheckSectionProps {
  settings: AIModelSettingsStore;
}

export function InlineSelfCheckSection({ settings }: InlineSelfCheckSectionProps) {
  return (
    <section className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
      <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-orange-600 dark:text-orange-400" />
              {t('AI 内联自检设置')}
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              {t(
                '在每页幻灯片 HTML 生成后立即调用 LLM 文本自检 + VLM 占位视觉自检，发现问题当场重试',
              )}
            </p>
          </div>
          <button
            onClick={() =>
              settings.updateInlineSelfCheckSettings({
                enabled: !settings.inlineSelfCheckSettings.enabled,
              })
            }
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${settings.inlineSelfCheckSettings.enabled ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600'}`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${settings.inlineSelfCheckSettings.enabled ? 'translate-x-6' : 'translate-x-1'}`}
            />
          </button>
        </div>
      </div>

      {settings.inlineSelfCheckSettings.enabled && (
        <div className="p-6 space-y-6">
          <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
              {t(
                '内联自检会在每页生成后立即调用模型，产生额外 API 费用但能尽早修复问题。VLM 占位视觉自检会发送渲染截图，请确保 auditVlm 路由选择支持图片输入的多模态模型。',
              )}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-start justify-between p-4 border border-slate-200 dark:border-slate-700 rounded-lg">
              <div className="flex-1 pr-4">
                <div className="flex items-center gap-2 mb-1">
                  <FileCode2 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <p className="text-sm font-medium text-slate-900 dark:text-white">
                    {t('LLM 内联文本自检')}
                  </p>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  {t(
                    '调用内容路由模型，逐页分析 HTML 源码的内容逻辑、视觉层级、细节执行与完成度，未通过当场重生成该页',
                  )}
                </p>
              </div>
              <button
                onClick={() =>
                  settings.updateInlineSelfCheckSettings({
                    llmCritique: !settings.inlineSelfCheckSettings.llmCritique,
                  })
                }
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${settings.inlineSelfCheckSettings.llmCritique ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600'}`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${settings.inlineSelfCheckSettings.llmCritique ? 'translate-x-6' : 'translate-x-1'}`}
                />
              </button>
            </div>

            <div className="flex items-start justify-between p-4 border border-slate-200 dark:border-slate-700 rounded-lg">
              <div className="flex-1 pr-4">
                <div className="flex items-center gap-2 mb-1">
                  <Eye className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                  <p className="text-sm font-medium text-slate-900 dark:text-white">
                    {t('VLM 内联占位视觉自检')}
                  </p>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  {t(
                    '调用 auditVlm 路由多模态模型，将占位图渲染为灰色块后的截图发送 VLM，基于真实占位布局效果评审对齐、留白与专业完成度',
                  )}
                </p>
              </div>
              <button
                onClick={() =>
                  settings.updateInlineSelfCheckSettings({
                    vlmPlaceholder: !settings.inlineSelfCheckSettings.vlmPlaceholder,
                  })
                }
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${settings.inlineSelfCheckSettings.vlmPlaceholder ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600'}`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${settings.inlineSelfCheckSettings.vlmPlaceholder ? 'translate-x-6' : 'translate-x-1'}`}
                />
              </button>
            </div>
          </div>

          <div className="p-4 border border-slate-200 dark:border-slate-700 rounded-lg">
            <div className="flex items-center gap-2 mb-3">
              <RotateCw className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <p className="text-sm font-medium text-slate-900 dark:text-white">
                {t('最大重新生成次数')}
              </p>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
              {t('当自检未通过时当场重做该页的最大次数（0 表示不重试）')}
            </p>
            <div className="flex items-center gap-3">
              {[0, 1, 2, 3].map((n) => (
                <button
                  key={n}
                  onClick={() => settings.updateInlineSelfCheckSettings({ maxRetries: n })}
                  className={`w-10 h-10 rounded-lg border-2 text-sm font-medium transition-all ${
                    settings.inlineSelfCheckSettings.maxRetries === n
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                      : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-500'
                  }`}
                >
                  {n}
                </button>
              ))}
              <span className="text-xs text-slate-400 ml-2">
                {settings.inlineSelfCheckSettings.maxRetries === 0
                  ? t('不重新生成')
                  : t('最多重试 {n} 次', { n: settings.inlineSelfCheckSettings.maxRetries })}
              </span>
            </div>
          </div>

          <div className="p-4 border border-slate-200 dark:border-slate-700 rounded-lg">
            <div className="flex items-center gap-2 mb-3">
              <Gauge className="w-4 h-4 text-orange-600 dark:text-orange-400" />
              <p className="text-sm font-medium text-slate-900 dark:text-white">
                {t('LLM 通过阈值（0-10）')}
              </p>
            </div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-green-700 dark:text-green-400">
                {t('通过阈值')}
              </label>
              <span className="text-sm font-mono font-bold text-green-600 dark:text-green-400">
                {settings.inlineSelfCheckSettings.threshold}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="10"
              value={settings.inlineSelfCheckSettings.threshold}
              onChange={(e) =>
                settings.updateInlineSelfCheckSettings({ threshold: parseInt(e.target.value) })
              }
              className="w-full accent-green-600"
            />
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              {t('高于此阈值视为通过，低于触发重生成')}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
