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

interface OutlineEditorProps extends Pick<
  GenerateState,
  | 'stage' | 'plan' | 'designLoading'
  | 'editableTitle' | 'setEditableTitle' | 'editableSlides'
> {
  accentColor: string;
  updateSlideTitle: (idx: number, title: string) => void;
  updateKeyPoint: (sIdx: number, pIdx: number, point: string) => void;
  removeKeyPoint: (sIdx: number, pIdx: number) => void;
  addKeyPoint: (sIdx: number) => void;
}

export function OutlineEditor({
  stage, plan, designLoading,
  editableTitle, setEditableTitle, editableSlides,
  accentColor,
  updateSlideTitle, updateKeyPoint, removeKeyPoint, addKeyPoint,
}: OutlineEditorProps) {
  return (
    <>          {stage === 'outline' && plan && !designLoading && (
            <div className="space-y-4">
              <Stepper currentStage={stage} />
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-1.5">
                  <Edit3 className="w-4 h-4" />
                  {t('演示标题')}
                </label>
                <input
                  type="text"
                  value={editableTitle}
                  onChange={(e) => setEditableTitle(e.target.value)}
                  className="w-full px-4 py-2.5 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-xl focus:ring-2 focus:border-transparent text-sm font-medium"
                  style={{ '--tw-ring-color': accentColor } as React.CSSProperties}
                />
                {plan.description && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
                    {plan.description}
                  </p>
                )}
              </div>

              <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
                {editableSlides.map((slide, sIdx) => {
                  const label = getPageTypeLabel(slide.pageType);
                  return (
                    <div
                      key={sIdx}
                      className="p-4 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/50"
                    >
                      <div className="flex items-center gap-2 mb-3">
                        <span
                          className="inline-flex items-center justify-center w-6 h-6 rounded-full text-white text-xs font-bold flex-shrink-0"
                          style={{ backgroundColor: accentColor }}
                        >
                          {sIdx + 1}
                        </span>
                        <span
                          className="px-2 py-0.5 rounded-md text-xs font-medium text-white"
                          style={{ backgroundColor: accentColor }}
                        >
                          {label}
                        </span>
                        <input
                          type="text"
                          value={slide.title}
                          onChange={(e) => updateSlideTitle(sIdx, e.target.value)}
                          className="flex-1 px-3 py-1.5 border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-white rounded-lg text-sm font-medium focus:ring-2 focus:border-transparent outline-none"
                          style={{ '--tw-ring-color': accentColor } as React.CSSProperties}
                        />
                      </div>

                      <div className="space-y-2 ml-8">
                        {slide.keyPoints.map((point, pIdx) => (
                          <div key={pIdx} className="flex items-center gap-2">
                            <span
                              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                              style={{ backgroundColor: accentColor }}
                            ></span>
                            <input
                              type="text"
                              value={point}
                              onChange={(e) => updateKeyPoint(sIdx, pIdx, e.target.value)}
                              className="flex-1 px-3 py-1.5 border border-slate-200 dark:border-slate-600 dark:bg-slate-800 dark:text-white rounded-lg text-sm focus:ring-2 focus:border-transparent outline-none"
                              style={{ '--tw-ring-color': accentColor } as React.CSSProperties}
                            />
                            <button
                              type="button"
                              onClick={() => removeKeyPoint(sIdx, pIdx)}
                              className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-md transition-colors flex-shrink-0"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => addKeyPoint(sIdx)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-dashed border-slate-300 dark:border-slate-500 text-slate-500 dark:text-slate-400 hover:border-blue-400 hover:text-blue-500 dark:hover:border-blue-400 transition-colors"
                        >
                          {t('+ 添加要点')}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}</>
  );
}
