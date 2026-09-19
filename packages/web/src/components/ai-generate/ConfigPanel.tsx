import { t } from '@/i18n';
import {
  X, Sparkles, FileCode, FileImage, ChevronDown, ChevronUp, Settings2,
  Edit3, ListChecks, ArrowLeft, RefreshCw, Check, Zap, Target, Users,
  Image as ImageIcon, Database, RotateCcw, AlertTriangle,
} from 'lucide-react';
import {
  COLOR_THEME_IDS, ICON_STYLE_IDS, audienceOptions, fontFamilyOptions,
  colorThemeOptions, iconStyleOptions, getPageTypeLabel, modeOptions, styles,
} from './options';
import { Stepper, HtmlPreview } from './preview';
import type {
  CollabMode, ColorTheme, Density, FontFamily, ImagePref, PipelineStage, SlideCountMode,
} from './types';
import { useGenerateState } from './useGenerateState';
import type { ReactNode, RefObject, ChangeEvent } from 'react';

type GenerateState = ReturnType<typeof useGenerateState>;
type ReferenceSlot = 'global' | 'cover' | 'content' | 'summary';
type ReferenceKind = 'html' | 'image';

interface ConfigPanelProps extends Pick<
  GenerateState,
  | 'stage' | 'planLoading'
  | 'setMode' | 'mode'
  | 'topic' | 'setTopic'
  | 'setShowReference' | 'showReference'
  | 'referenceText' | 'referenceSource'
  | 'referenceTruncated' | 'referenceOriginalChars' | 'referenceInitial'
  | 'setStyle' | 'style'
  | 'setShowAdvanced' | 'showAdvanced'
  | 'setSlideCountMode' | 'slideCountMode'
  | 'setExactSlideCount' | 'exactSlideCount'
  | 'minSlideCount' | 'setMinSlideCount' | 'maxSlideCount' | 'setMaxSlideCount'
  | 'audience' | 'setAudience'
  | 'setGenLanguage' | 'genLanguage'
  | 'setFontFamily' | 'fontFamily'
  | 'setBackgroundEnabled' | 'backgroundEnabled'
  | 'setAutoAuditEnabled' | 'autoAuditEnabled'
  | 'setInlineSelfCheckEnabled' | 'inlineSelfCheckEnabled'
  | 'setColorTheme' | 'colorTheme'
  | 'setDensity' | 'density'
  | 'setImagePreference' | 'imagePreference'
  | 'setIconStyle' | 'iconStyle'
> {
  renderReferenceRow: (slot: ReferenceSlot, kind: ReferenceKind) => ReactNode;
  renderCategoryCard: (slot: ReferenceSlot, title: string, subtitle: string) => ReactNode;
  handleReferenceFileChange: (e: ChangeEvent<HTMLInputElement>) => void;
  updateReferenceText: (value: string) => void;
  effectiveReferenceLimit: number;
  referenceOverLimit: boolean;
  htmlInputRef: RefObject<HTMLInputElement>;
  imageInputRef: RefObject<HTMLInputElement>;
}

export function ConfigPanel({
  stage, planLoading, setMode, mode, topic, setTopic,
  setShowReference, showReference, referenceText, referenceSource,
  referenceTruncated, referenceOriginalChars, referenceInitial,
  setStyle, style, setShowAdvanced, showAdvanced,
  setSlideCountMode, slideCountMode, setExactSlideCount, exactSlideCount,
  minSlideCount, setMinSlideCount, maxSlideCount, setMaxSlideCount,
  audience, setAudience, setGenLanguage, genLanguage,
  setFontFamily, fontFamily, setBackgroundEnabled, backgroundEnabled,
  setAutoAuditEnabled, autoAuditEnabled, setInlineSelfCheckEnabled, inlineSelfCheckEnabled,
  setColorTheme, colorTheme, setDensity, density,
  setImagePreference, imagePreference, setIconStyle, iconStyle,
  renderReferenceRow, renderCategoryCard, handleReferenceFileChange,
  updateReferenceText, effectiveReferenceLimit, referenceOverLimit,
  htmlInputRef, imageInputRef,
}: ConfigPanelProps) {
  return (
    <>          {stage === 'config' && !planLoading && (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  {t('生成模式')}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {modeOptions.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setMode(m.id)}
                      className={`relative p-3 rounded-xl border-2 text-left transition-all ${
                        mode === m.id
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                          : 'border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500'
                      }`}
                    >
                      {m.badge && (
                        <span className="absolute -top-2 -right-2 px-1.5 py-0.5 bg-gradient-to-r from-orange-400 to-pink-500 text-white text-[10px] font-bold rounded-full">
                          {m.badge}
                        </span>
                      )}
                      <div
                        className={`mb-1.5 ${mode === m.id ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400'}`}
                      >
                        {m.icon}
                      </div>
                      <p className="font-semibold text-sm text-slate-900 dark:text-white">
                        {t(m.title)}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-tight">
                        {t(m.desc)}
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  {t('演示主题')}
                </label>
                <textarea
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder={t(
                    '例如：2024年度工作总结与2025规划，包含业绩回顾、问题分析、明年计划，10页左右...',
                  )}
                  className="w-full h-24 px-4 py-3 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-xl resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                />
              </div>

              {/* 参考素材（来自企业知识库 / RAG）：planning 阶段作为「权威素材」注入大纲 prompt */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-600 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowReference(!showReference)}
                  className="w-full flex items-center gap-2 px-4 py-3 bg-slate-50 dark:bg-slate-700/50 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                >
                  <Database
                    className={`w-4 h-4 ${referenceText ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'}`}
                  />
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    {t('参考素材（来自企业知识库 / RAG）')}
                  </span>
                  {referenceSource && (
                    <span className="px-1.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/40 text-[10px] font-medium text-blue-700 dark:text-blue-300">
                      {referenceSource}
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-2">
                    {referenceText ? (
                      <span
                        className={`text-[11px] ${referenceOverLimit ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'}`}
                      >
                        {referenceText.length.toLocaleString()} /{' '}
                        {effectiveReferenceLimit.toLocaleString()}
                        {t('字')}
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-400 dark:text-slate-500">
                        {t('未注入')}
                      </span>
                    )}
                    {showReference ? (
                      <ChevronUp className="w-4 h-4 text-slate-400" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-slate-400" />
                    )}
                  </span>
                </button>

                {showReference && (
                  <div className="p-3 space-y-2 border-t border-slate-200 dark:border-slate-600">
                    {(referenceTruncated || referenceOverLimit) && (
                      <div className="flex items-start gap-1.5 px-2.5 py-2 rounded-lg bg-orange-50 dark:bg-orange-900/20 text-[11px] text-orange-600 dark:text-orange-400">
                        <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
                        <span>
                          {referenceTruncated
                            ? t('已按生成要求裁剪：原 {from} 字 → {to} 字（每页约 800 字）', {
                                from: referenceOriginalChars.toLocaleString(),
                                to: effectiveReferenceLimit.toLocaleString(),
                              })
                            : t('当前页数下素材上限为 {n} 字，超出部分将不会被用于生成', {
                                n: effectiveReferenceLimit.toLocaleString(),
                              })}
                        </span>
                      </div>
                    )}
                    <textarea
                      value={referenceText}
                      onChange={(e) => updateReferenceText(e.target.value)}
                      placeholder={t(
                        '粘贴或编辑权威素材：企业知识库检索结果、文档整理稿、对话上下文摘要……这些内容会在规划大纲阶段作为「权威素材」参与生成。',
                      )}
                      className="w-full h-40 px-3 py-2.5 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-xs font-mono leading-relaxed"
                    />
                    <div className="flex items-center justify-between gap-3">
                      <span
                        className={`text-[11px] ${
                          referenceOverLimit
                            ? 'text-red-600 dark:text-red-400'
                            : referenceText.length >= effectiveReferenceLimit * 0.9
                              ? 'text-orange-600 dark:text-orange-400'
                              : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {referenceText.length.toLocaleString()} /{' '}
                        {effectiveReferenceLimit.toLocaleString()}
                        {t('字')}
                      </span>
                      <div className="flex items-center gap-3">
                        {referenceInitial && referenceText !== referenceInitial && (
                          <button
                            type="button"
                            onClick={() => updateReferenceText(referenceInitial)}
                            className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                          >
                            <RotateCcw className="w-3 h-3" />
                            {t('恢复初始素材')}
                          </button>
                        )}
                        {referenceText && (
                          <button
                            type="button"
                            onClick={() => updateReferenceText('')}
                            className="text-[11px] text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors"
                          >
                            {t('清空素材')}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  {t('风格选择')}
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {styles.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setStyle(s.id as any)}
                      className={`p-2.5 rounded-xl border-2 text-left transition-all ${
                        style === s.id
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                          : 'border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500'
                      }`}
                    >
                      <p className="font-medium text-sm text-slate-900 dark:text-white">{s.name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{s.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors w-full"
              >
                <Settings2 className="w-4 h-4" />
                <span>{t('高级排版选项')}</span>
                {showAdvanced ? (
                  <ChevronUp className="w-4 h-4 ml-auto" />
                ) : (
                  <ChevronDown className="w-4 h-4 ml-auto" />
                )}
              </button>

              {showAdvanced && (
                <div className="space-y-4 p-4 bg-slate-50 dark:bg-slate-700/50 rounded-xl">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      {t('幻灯片页数')}
                    </label>
                    <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-600 overflow-hidden mb-3 w-full">
                      {(
                        [
                          { id: 'auto', name: '自动' },
                          { id: 'exact', name: '固定页数' },
                          { id: 'range', name: '页数区间' },
                        ] as {
                          id: SlideCountMode;
                          name: string;
                        }[]
                      ).map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setSlideCountMode(tab.id)}
                          className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${
                            slideCountMode === tab.id
                              ? 'bg-blue-600 text-white'
                              : 'bg-white dark:bg-slate-600/50 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-600'
                          }`}
                        >
                          {tab.name}
                        </button>
                      ))}
                    </div>
                    <div>
                      {slideCountMode === 'auto' && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                          {t(
                            'AI 根据主题自行决定，默认 8 页。可在主题中直接指定（如「5-10页」「做6页」等）。',
                          )}
                        </p>
                      )}
                      {slideCountMode === 'exact' && (
                        <div className="flex items-center gap-3">
                          <div className="flex items-center rounded-lg border border-slate-200 dark:border-slate-600 overflow-hidden">
                            <button
                              type="button"
                              onClick={() => setExactSlideCount((v) => Math.max(1, v - 1))}
                              className="px-3 py-2 bg-slate-50 dark:bg-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 text-lg leading-none"
                            >
                              −
                            </button>
                            <input
                              type="number"
                              min={1}
                              max={20}
                              value={exactSlideCount}
                              onChange={(e) => {
                                const v = parseInt(e.target.value || '0', 10);
                                if (!Number.isNaN(v))
                                  setExactSlideCount(Math.max(1, Math.min(20, v)));
                              }}
                              className="w-16 text-center border-x border-slate-200 dark:border-slate-600 py-2 text-sm font-medium bg-white dark:bg-slate-700 text-slate-900 dark:text-white outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => setExactSlideCount((v) => Math.min(20, v + 1))}
                              className="px-3 py-2 bg-slate-50 dark:bg-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 text-lg leading-none"
                            >
                              +
                            </button>
                          </div>
                          <p className="text-sm text-slate-700 dark:text-slate-300">
                            {t('固定')}
                            <span className="font-semibold text-blue-600 dark:text-blue-400">
                              {exactSlideCount}
                            </span>
                            {t('页（范围 1~20）')}
                          </p>
                        </div>
                      )}
                      {slideCountMode === 'range' && (
                        <div className="flex items-center flex-wrap gap-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-500 dark:text-slate-400">
                              {t('最少')}
                            </span>
                            <div className="flex items-center rounded-lg border border-slate-200 dark:border-slate-600 overflow-hidden">
                              <button
                                type="button"
                                onClick={() => {
                                  const next = Math.max(1, minSlideCount - 1);
                                  setMinSlideCount(next);
                                  if (next > maxSlideCount) setMaxSlideCount(next);
                                }}
                                className="px-2.5 py-2 bg-slate-50 dark:bg-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 text-lg leading-none"
                              >
                                −
                              </button>
                              <input
                                type="number"
                                min={1}
                                max={20}
                                value={minSlideCount}
                                onChange={(e) => {
                                  const v = parseInt(e.target.value || '0', 10);
                                  if (Number.isNaN(v)) return;
                                  const next = Math.max(1, Math.min(20, v));
                                  setMinSlideCount(next);
                                  if (next > maxSlideCount) setMaxSlideCount(next);
                                }}
                                className="w-14 text-center border-x border-slate-200 dark:border-slate-600 py-2 text-sm font-medium bg-white dark:bg-slate-700 text-slate-900 dark:text-white outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const next = Math.min(20, minSlideCount + 1);
                                  setMinSlideCount(next);
                                  if (next > maxSlideCount) setMaxSlideCount(next);
                                }}
                                className="px-2.5 py-2 bg-slate-50 dark:bg-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 text-lg leading-none"
                              >
                                +
                              </button>
                            </div>
                          </div>
                          <span className="text-slate-400 dark:text-slate-500 font-medium">~</span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-500 dark:text-slate-400">
                              {t('最多')}
                            </span>
                            <div className="flex items-center rounded-lg border border-slate-200 dark:border-slate-600 overflow-hidden">
                              <button
                                type="button"
                                onClick={() => {
                                  const next = Math.max(1, maxSlideCount - 1);
                                  setMaxSlideCount(next);
                                  if (next < minSlideCount) setMinSlideCount(next);
                                }}
                                className="px-2.5 py-2 bg-slate-50 dark:bg-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 text-lg leading-none"
                              >
                                −
                              </button>
                              <input
                                type="number"
                                min={1}
                                max={20}
                                value={maxSlideCount}
                                onChange={(e) => {
                                  const v = parseInt(e.target.value || '0', 10);
                                  if (Number.isNaN(v)) return;
                                  const next = Math.max(1, Math.min(20, v));
                                  setMaxSlideCount(next);
                                  if (next < minSlideCount) setMinSlideCount(next);
                                }}
                                className="w-14 text-center border-x border-slate-200 dark:border-slate-600 py-2 text-sm font-medium bg-white dark:bg-slate-700 text-slate-900 dark:text-white outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const next = Math.min(20, maxSlideCount + 1);
                                  setMaxSlideCount(next);
                                  if (next < minSlideCount) setMinSlideCount(next);
                                }}
                                className="px-2.5 py-2 bg-slate-50 dark:bg-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 text-lg leading-none"
                              >
                                +
                              </button>
                            </div>
                          </div>
                          <p className="text-sm text-slate-700 dark:text-slate-300 ml-auto w-full sm:ml-0 sm:w-auto mt-1 sm:mt-0">
                            {t('页数范围')}
                            <span className="font-semibold text-blue-600 dark:text-blue-400">
                              {minSlideCount} ~ {maxSlideCount}
                            </span>
                            {t('，AI 按主题复杂度自决定（范围 1~20）')}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      {t('目标受众')}
                    </label>
                    <select
                      value={audience}
                      onChange={(e) => setAudience(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-slate-700"
                    >
                      {audienceOptions.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {t(opt.name)} · {t(opt.desc)}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      {t('影响内容深度、用词专业度和案例风格')}
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      {t('生成语言')}
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {(
                        [
                          { id: 'follow', name: '跟随界面' },
                          { id: 'zh-CN', name: '中文' },
                          { id: 'en', name: 'English' },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setGenLanguage(opt.id)}
                          className={`p-2 rounded-xl border-2 text-center transition-all ${
                            genLanguage === opt.id
                              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                              : 'border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500'
                          }`}
                        >
                          <p className="font-medium text-sm text-slate-900 dark:text-white">
                            {t(opt.name)}
                          </p>
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      {t('仅影响本次 AI 生成的正文语言，不改变界面语言')}
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      {t('字体风格')}
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {fontFamilyOptions.map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => setFontFamily(f.id)}
                          className={`p-2 rounded-xl border-2 text-left transition-all ${
                            fontFamily === f.id
                              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                              : 'border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500'
                          }`}
                          // NOTE: FONT_STACK_MONO —— 若修改请同步：
                          //   - ai: packages/ai/src/agents/html-presentation-agent.ts#getFontStack('mono')
                          //   - web: packages/web/src/components/AIGenerateModal.tsx L### mono 预览 style
                          //   目的：CJK 字体在 Windows 回退时命中微软雅黑(PingFangSC)而不是 SimSun(衬线宋)。
                          style={{
                            fontFamily:
                              f.id === 'serif'
                                ? "Georgia,'Noto Serif SC',serif"
                                : f.id === 'mono'
                                  ? t(
                                      "'JetBrains Mono', ui-monospace, 'Cascadia Code', Consolas, 'PingFang SC', 'Microsoft YaHei', '微软雅黑', 'Noto Sans SC', 'Noto Sans Mono CJK SC', monospace",
                                    )
                                  : "system-ui,'PingFang SC','Microsoft YaHei',sans-serif",
                          }}
                        >
                          <p className="font-medium text-sm text-slate-900 dark:text-white">
                            {t(f.name)}
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                            {t(f.desc)}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between">
                      <div>
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                          {t('自动添加背景图')}
                        </label>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          {t('为封面、目录、内容、总结页生成匹配主题的背景图')}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setBackgroundEnabled(!backgroundEnabled)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${backgroundEnabled ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600'}`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${backgroundEnabled ? 'translate-x-6' : 'translate-x-1'}`}
                        />
                      </button>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between">
                      <div>
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                          {t('AI 自动评审')}
                        </label>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          {t(
                            '生成完成后调用多引擎自动审核幻灯片，发现问题自动修复或重新生成（可在设置→AI模型→AI审核设置中配置严格度与阈值）',
                          )}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setAutoAuditEnabled(!autoAuditEnabled)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${autoAuditEnabled ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600'}`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${autoAuditEnabled ? 'translate-x-6' : 'translate-x-1'}`}
                        />
                      </button>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between">
                      <div>
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                          {t('内联自检')}
                        </label>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          {t(
                            '每页生成后立即执行 LLM 文本自检 + VLM 占位视觉评审，未通过当场重做（可在设置→AI模型→AI内联自检设置中配置子项）',
                          )}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setInlineSelfCheckEnabled(!inlineSelfCheckEnabled)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${inlineSelfCheckEnabled ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600'}`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${inlineSelfCheckEnabled ? 'translate-x-6' : 'translate-x-1'}`}
                        />
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      {t('配色主题')}
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => setColorTheme('')}
                        className={`px-3 py-1.5 rounded-lg text-sm border-2 transition-all ${
                          colorTheme === ''
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                            : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-slate-300'
                        }`}
                      >
                        {t('自动')}
                      </button>
                      {colorThemeOptions.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => setColorTheme(c.id)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border-2 transition-all ${
                            colorTheme === c.id
                              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                              : 'border-slate-200 dark:border-slate-600 hover:border-slate-300'
                          }`}
                        >
                          <span
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: c.color }}
                          ></span>
                          <span className="text-slate-700 dark:text-slate-300">{t(c.name)}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      {t('内容密度')}
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {(
                        [
                          { id: 'compact', name: '紧凑', desc: t('信息量大') },
                          { id: 'normal', name: '适中', desc: t('平衡') },
                          { id: 'spacious', name: '宽松', desc: t('留白多') },
                        ] as const
                      ).map((d) => (
                        <button
                          key={d.id}
                          onClick={() => setDensity(d.id)}
                          className={`p-2 rounded-lg border-2 text-center transition-all ${
                            density === d.id
                              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                              : 'border-slate-200 dark:border-slate-600 hover:border-slate-300'
                          }`}
                        >
                          <p className="font-medium text-sm text-slate-900 dark:text-white">
                            {d.name}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">{d.desc}</p>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      {t('配图偏好')}
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {(
                        [
                          { id: 'content-only', name: '仅内容页配图', desc: t('推荐') },
                          { id: 'minimal', name: '尽量少图', desc: t('文字为主') },
                          { id: 'none', name: '无图', desc: t('纯文字') },
                          { id: 'all', name: '每页都配图', desc: t('含封面') },
                        ] as const
                      ).map((p) => (
                        <button
                          key={p.id}
                          onClick={() => setImagePreference(p.id)}
                          className={`p-2 rounded-lg border-2 text-left transition-all ${
                            imagePreference === p.id
                              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                              : 'border-slate-200 dark:border-slate-600 hover:border-slate-300'
                          }`}
                        >
                          <p className="font-medium text-sm text-slate-900 dark:text-white">
                            {p.name}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">{p.desc}</p>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      {t('列表图标风格')}
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {iconStyleOptions.map((opt) => (
                        <button
                          key={opt.id}
                          onClick={() => setIconStyle(opt.id)}
                          className={`p-2 rounded-lg border-2 text-left transition-all ${
                            iconStyle === opt.id
                              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                              : 'border-slate-200 dark:border-slate-600 hover:border-slate-300'
                          }`}
                        >
                          <p className="font-medium text-sm text-slate-900 dark:text-white">
                            {t(opt.name)}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {t(opt.desc)}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  {t('参考文件（可选）')}
                </label>

                {/* 全局共享参考（向后兼容 NFR-3）：未单独上传分类参考时的兜底来源 */}
                <div className="mb-4">
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                    {t('全局共享参考：未单独上传分类参考时，作为所有页面的兜底来源')}
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    {renderReferenceRow('global', 'html')}
                    {renderReferenceRow('global', 'image')}
                  </div>
                </div>

                {/* 三类分类参考（FR-13.1 / C-15）：封面 / 内容 / 总结 各自独立通道 */}
                <div className="space-y-3">
                  {renderCategoryCard(
                    'cover',
                    t('封面参考（仅用于首页封面页）'),
                    t('未上传则封面页不应用任何参考属性'),
                  )}
                  {renderCategoryCard(
                    'content',
                    t('内容参考（用于目录和正文内容页）'),
                    t('未上传则目录/内容页不应用任何参考属性（目录页与正文页共用同一份内容参考）'),
                  )}
                  {renderCategoryCard(
                    'summary',
                    t('总结参考（仅用于结尾总结页）'),
                    t('未上传则总结页不应用任何参考属性'),
                  )}
                </div>

                {/* 隐藏文件输入：由 triggerReferenceFile 触发，按 pendingRef 区分 slot/kind */}
                <input
                  ref={htmlInputRef}
                  type="file"
                  accept=".html,.htm"
                  onChange={handleReferenceFileChange}
                  className="hidden"
                />
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleReferenceFileChange}
                  className="hidden"
                />
              </div>
            </>
          )}</>
  );
}
