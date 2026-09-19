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

type GenerateState = ReturnType<typeof useGenerateState>;

interface RenderedSlidesProps extends Pick<
  GenerateState,
  | 'stage' | 'mode' | 'inlineSelfCheckEnabled'
  | 'renderedSlides' | 'approvedSlides' | 'regeneratingSlides' | 'expandedSlide' | 'setExpandedSlide'
> {
  toggleApprovedSlide: (idx: number) => void;
  handleRegenerateSlide: (idx: number) => void;
}

export function RenderedSlides({
  stage, mode, inlineSelfCheckEnabled,
  renderedSlides, approvedSlides, regeneratingSlides, expandedSlide, setExpandedSlide,
  toggleApprovedSlide, handleRegenerateSlide,
}: RenderedSlidesProps) {
  return (
    <>          {stage === 'layout-preview' && (
            <div className="space-y-4">
              <Stepper currentStage={stage} />
              <div className="text-center mb-2">
                <h4 className="text-lg font-semibold text-slate-900 dark:text-white">
                  {t('预览页面排版')}
                </h4>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  {mode === 'collaborative'
                    ? t('逐页审核排版，AI已自动评审，未通过页面可手动重新生成')
                    : inlineSelfCheckEnabled
                      ? t('每页已通过AI设计评审，确认后将开始生成配图和最终润色')
                      : t('检查每页排版结构，确认后将开始生成配图和最终润色')}
                </p>
              </div>
              {inlineSelfCheckEnabled && (
                <div className="flex items-center justify-center gap-4 text-xs text-slate-500 dark:text-slate-400">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-green-500"></span>
                    {t('评审通过')}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                    {t('评审未通过（已用最佳版本）')}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-slate-400"></span>
                    {t('未开启评审')}
                  </span>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-h-[55vh] overflow-y-auto pr-1">
                {renderedSlides.map((slide, idx) => {
                  const label = getPageTypeLabel(slide.pageType);
                  const isApproved = approvedSlides[idx] !== false;
                  const isRegenerating = regeneratingSlides.has(idx);
                  const critique = slide.critique;
                  const hasCritique = !!critique;
                  const critiquePassed = critique?.passed ?? false;
                  const score = critique?.score;
                  const attempts = critique?.attempts ?? 0;
                  const issues = critique?.issues ?? [];
                  const isExpanded = expandedSlide === idx;
                  const scoreColor = !hasCritique
                    ? 'text-slate-400 bg-slate-100 dark:bg-slate-700'
                    : critiquePassed
                      ? 'text-green-700 bg-green-100 dark:bg-green-900/40 dark:text-green-300'
                      : 'text-amber-700 bg-amber-100 dark:bg-amber-900/40 dark:text-amber-300';
                  const scoreDot = !hasCritique
                    ? 'bg-slate-400'
                    : critiquePassed
                      ? 'bg-green-500'
                      : 'bg-amber-500';
                  return (
                    <div
                      key={idx}
                      className={`rounded-xl border-2 overflow-hidden transition-all ${
                        isApproved
                          ? hasCritique && !critiquePassed
                            ? 'border-amber-300 dark:border-amber-700'
                            : 'border-slate-200 dark:border-slate-600'
                          : 'border-amber-400 bg-amber-50 dark:bg-amber-900/20'
                      } ${isRegenerating ? 'opacity-60' : ''}`}
                    >
                      <div
                        className="relative bg-slate-100 flex items-center justify-center w-full"
                        style={{ aspectRatio: '1280 / 720' }}
                      >
                        {isRegenerating ? (
                          <div className="flex flex-col items-center gap-2 text-slate-400">
                            <RefreshCw className="w-6 h-6 animate-spin" />
                            <span className="text-xs">{t('重新生成中...')}</span>
                          </div>
                        ) : (
                          <HtmlPreview html={slide.html} fit />
                        )}
                        {hasCritique && (
                          <div
                            className={`absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${scoreColor}`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${scoreDot}`}></span>
                            {score?.toFixed(1)}
                            {attempts > 1 && <span className="opacity-70">×{attempts}</span>}
                          </div>
                        )}
                        {mode === 'collaborative' && !isRegenerating && (
                          <button
                            type="button"
                            onClick={() => toggleApprovedSlide(idx)}
                            className={`absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
                              isApproved
                                ? 'bg-green-500 text-white'
                                : 'bg-white border-2 border-amber-400 text-amber-500'
                            }`}
                          >
                            {isApproved ? <Check className="w-4 h-4" /> : '!'}
                          </button>
                        )}
                      </div>
                      <div className="p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-bold text-slate-400">#{idx + 1}</span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium text-white bg-blue-500">
                            {label}
                          </span>
                        </div>
                        <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                          {slide.title}
                        </p>
                        {hasCritique && issues.length > 0 && (
                          <div className="mt-2">
                            <button
                              type="button"
                              onClick={() => setExpandedSlide(isExpanded ? null : idx)}
                              className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400 hover:underline"
                            >
                              {issues.length}
                              {t('个设计问题')}
                              {isExpanded ? (
                                <ChevronUp className="w-3 h-3" />
                              ) : (
                                <ChevronDown className="w-3 h-3" />
                              )}
                            </button>
                            {isExpanded && (
                              <ul className="mt-1.5 space-y-1">
                                {issues.slice(0, 5).map((issue, i) => (
                                  <li
                                    key={i}
                                    className="text-[11px] text-slate-600 dark:text-slate-400 flex items-start gap-1"
                                  >
                                    <span className="text-amber-500 mt-0.5">•</span>
                                    <span className="line-clamp-2">{issue}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
                        {(mode === 'collaborative' || (hasCritique && !critiquePassed)) &&
                          !isRegenerating && (
                            <button
                              type="button"
                              onClick={() => handleRegenerateSlide(idx)}
                              className="mt-2 inline-flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
                            >
                              <RefreshCw className="w-3 h-3" />
                              {t('重新生成此页')}
                            </button>
                          )}
                        {!isApproved && mode === 'collaborative' && (
                          <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                            {t('未通过用户审核，点击右上角标记可恢复')}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}</>
  );
}
