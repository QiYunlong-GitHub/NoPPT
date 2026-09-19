import { t } from '@/i18n';
import {
  ShieldCheck,
  AlertTriangle,
  FileCode2,
  Eye,
  Wrench,
  Gauge,
  RotateCw,
} from 'lucide-react';
import type { AIModelSettingsStore } from './types';

interface AuditSettingsSectionProps {
  settings: AIModelSettingsStore;
}

export function AuditSettingsSection({ settings }: AuditSettingsSectionProps) {
  return (
    <section className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
      <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              {t('AI 审核设置')}
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              {t('生成完成后自动调用多引擎审核幻灯片，发现问题自动修复或重新生成')}
            </p>
          </div>
          <button
            onClick={() =>
              settings.updateAuditSettings({ enabled: !settings.auditSettings.enabled })
            }
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${settings.auditSettings.enabled ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600'}`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${settings.auditSettings.enabled ? 'translate-x-6' : 'translate-x-1'}`}
            />
          </button>
        </div>
      </div>

      {settings.auditSettings.enabled && (
        <div className="p-6 space-y-6">
          <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
              {t(
                '审核功能会在生成完成后额外调用大模型进行评审，将产生额外的 API 费用。LLM 文本评审逐页读取 HTML 源码；VLM 视觉评审需发送截图，请确保 auditVlm 路由选择支持图片输入的多模态模型。',
              )}
            </p>
          </div>

          <AuditReviewSettings settings={settings} />
          <AuditEngineSettings settings={settings} />
        </div>
      )}
    </section>
  );
}

function AuditReviewSettings({ settings }: { settings: AIModelSettingsStore }) {
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex items-start justify-between p-4 border border-slate-200 dark:border-slate-700 rounded-lg">
          <div className="flex-1 pr-4">
            <div className="flex items-center gap-2 mb-1">
              <FileCode2 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <p className="text-sm font-medium text-slate-900 dark:text-white">
                {t('LLM 文本评审')}
              </p>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              {t(
                '调用「审核文本评审 (LLM)」路由模型，逐页分析 HTML 源码的内容逻辑、视觉层级、细节执行、功能性与创新性，输出结构化评分和问题列表',
              )}
            </p>
          </div>
          <button
            onClick={() =>
              settings.updateAuditSettings({ llmReview: !settings.auditSettings.llmReview })
            }
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${settings.auditSettings.llmReview ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600'}`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${settings.auditSettings.llmReview ? 'translate-x-6' : 'translate-x-1'}`}
            />
          </button>
        </div>

        <div className="flex items-start justify-between p-4 border border-slate-200 dark:border-slate-700 rounded-lg">
          <div className="flex-1 pr-4">
            <div className="flex items-center gap-2 mb-1">
              <Eye className="w-4 h-4 text-purple-600 dark:text-purple-400" />
              <p className="text-sm font-medium text-slate-900 dark:text-white">
                {t('VLM 视觉评审')}
              </p>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              {t(
                '调用「审核视觉评审 (VLM)」路由模型，将每页渲染截图发送给多模态模型，基于真实渲染效果评审对齐、留白、色彩与专业完成度',
              )}
            </p>
          </div>
          <button
            onClick={() =>
              settings.updateAuditSettings({ vlmReview: !settings.auditSettings.vlmReview })
            }
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${settings.auditSettings.vlmReview ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600'}`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${settings.auditSettings.vlmReview ? 'translate-x-6' : 'translate-x-1'}`}
            />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex items-start justify-between p-4 border border-slate-200 dark:border-slate-700 rounded-lg">
          <div className="flex-1 pr-4">
            <div className="flex items-center gap-2 mb-1">
              <Wrench className="w-4 h-4 text-green-600 dark:text-green-400" />
              <p className="text-sm font-medium text-slate-900 dark:text-white">
                {t('自动修复')}
              </p>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              {t(
                '对可自动修复的问题（如卡片强制高度、图标错误包裹等）直接修改 HTML 并二次验证',
              )}
            </p>
          </div>
          <button
            onClick={() =>
              settings.updateAuditSettings({ autoFix: !settings.auditSettings.autoFix })
            }
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${settings.auditSettings.autoFix ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600'}`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${settings.auditSettings.autoFix ? 'translate-x-6' : 'translate-x-1'}`}
            />
          </button>
        </div>

        <div className="p-4 border border-slate-200 dark:border-slate-700 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Gauge className="w-4 h-4 text-orange-600 dark:text-orange-400" />
            <p className="text-sm font-medium text-slate-900 dark:text-white">
              {t('严格级别')}
            </p>
          </div>
          <select
            value={settings.auditSettings.strictness}
            onChange={(e) =>
              settings.updateAuditSettings({ strictness: e.target.value as any })
            }
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
          >
            <option value="strict">{t('严格 - 高标准，适合正式汇报')}</option>
            <option value="normal">{t('标准 - 平衡质量与效率（推荐）')}</option>
            <option value="relaxed">{t('宽松 - 仅阻断严重问题')}</option>
          </select>
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
          {t('当评审分数低于阈值且存在严重问题时，自动重新生成该页幻灯片的最大重试次数')}
        </p>
        <div className="flex items-center gap-3">
          {[0, 1, 2, 3].map((n) => (
            <button
              key={n}
              onClick={() => settings.updateAuditSettings({ maxRegenerationRetries: n })}
              className={`w-10 h-10 rounded-lg border-2 text-sm font-medium transition-all ${
                settings.auditSettings.maxRegenerationRetries === n
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                  : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-500'
              }`}
            >
              {n}
            </button>
          ))}
          <span className="text-xs text-slate-400 ml-2">
            {settings.auditSettings.maxRegenerationRetries === 0
              ? t('不重新生成')
              : t('最多重试 {n} 次', { n: settings.auditSettings.maxRegenerationRetries })}
          </span>
        </div>
      </div>
    </>
  );
}

function AuditEngineSettings({ settings }: { settings: AIModelSettingsStore }) {
  return (
    <>
      <div className="p-4 border border-slate-200 dark:border-slate-700 rounded-lg">
        <p className="text-sm font-medium text-slate-900 dark:text-white mb-3">
          {t('审核引擎开关')}
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {(
            [
              { key: 'layout', name: '布局样式', desc: t('HTML结构与8pt网格') },
              { key: 'visual', name: '视觉设计', desc: t('对比度/色彩/复杂度') },
              { key: 'content', name: '内容质量', desc: t('逻辑/可访问性/LLM评审') },
              { key: 'fidelity', name: '渲染保真', desc: t('截图与元数据对比') },
            ] as const
          ).map(({ key, name, desc }) => (
            <label
              key={key}
              className={`flex flex-col p-3 rounded-lg border-2 cursor-pointer transition-all ${
                settings.auditSettings.engines[key]
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 opacity-60'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-slate-900 dark:text-white">
                  {name}
                </span>
                <input
                  type="checkbox"
                  checked={settings.auditSettings.engines[key]}
                  onChange={(e) =>
                    settings.updateAuditSettings({
                      engines: { ...settings.auditSettings.engines, [key]: e.target.checked },
                    })
                  }
                  className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                />
              </div>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">{desc}</span>
            </label>
          ))}
        </div>
        <p className="text-xs text-slate-400 mt-3">
          {t(
            '提示：内容质量引擎包含 LLM 文本评审；视觉设计引擎包含 VLM 视觉评审（需分别开启上方对应开关）',
          )}
        </p>
      </div>

      <div className="p-4 border border-slate-200 dark:border-slate-700 rounded-lg">
        <p className="text-sm font-medium text-slate-900 dark:text-white mb-3">
          {t('分数阈值（0-100）')}
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-green-700 dark:text-green-400">
                {t('通过分数')}
              </label>
              <span className="text-sm font-mono font-bold text-green-600 dark:text-green-400">
                {settings.auditSettings.thresholds.pass}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={settings.auditSettings.thresholds.pass}
              onChange={(e) =>
                settings.updateAuditSettings({
                  thresholds: {
                    ...settings.auditSettings.thresholds,
                    pass: parseInt(e.target.value),
                  },
                })
              }
              className="w-full accent-green-600"
            />
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              {t('高于此分数视为通过')}
            </p>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-amber-700 dark:text-amber-400">
                {t('警告分数')}
              </label>
              <span className="text-sm font-mono font-bold text-amber-600 dark:text-amber-400">
                {settings.auditSettings.thresholds.warn}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={settings.auditSettings.thresholds.warn}
              onChange={(e) =>
                settings.updateAuditSettings({
                  thresholds: {
                    ...settings.auditSettings.thresholds,
                    warn: parseInt(e.target.value),
                  },
                })
              }
              className="w-full accent-amber-600"
            />
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              {t('低于此分数触发重新生成')}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
