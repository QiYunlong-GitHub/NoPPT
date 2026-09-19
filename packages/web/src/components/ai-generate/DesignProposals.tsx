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

interface DesignProposalsProps extends Pick<
  GenerateState,
  | 'stage' | 'layoutLoading' | 'designProposals' | 'selectedDesign' | 'setSelectedDesign'
> {}

export function DesignProposals({
  stage, layoutLoading, designProposals, selectedDesign, setSelectedDesign,
}: DesignProposalsProps) {
  return (
    <>          {stage === 'design' && !layoutLoading && (
            <div className="space-y-4">
              <Stepper currentStage={stage} />
              <div className="text-center mb-2">
                <h4 className="text-lg font-semibold text-slate-900 dark:text-white">
                  {t('选择视觉风格')}
                </h4>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  {t('AI 根据内容推荐了 3 套设计方案，点击选择你喜欢的风格')}
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {designProposals.map((proposal) => {
                  const isSelected = selectedDesign?.id === proposal.id;
                  return (
                    <div
                      key={proposal.id}
                      onClick={() => setSelectedDesign(proposal)}
                      className={`rounded-xl border-2 overflow-hidden cursor-pointer transition-all ${
                        isSelected
                          ? 'border-blue-500 ring-2 ring-blue-200 dark:ring-blue-800'
                          : 'border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500'
                      }`}
                    >
                      <div className="relative">
                        <div
                          className="w-full overflow-hidden bg-slate-100 flex items-center justify-center"
                          style={{ aspectRatio: '1280 / 720' }}
                        >
                          <HtmlPreview html={proposal.coverHtml} fit />
                        </div>
                        {isSelected && (
                          <div className="absolute top-2 right-2 w-7 h-7 bg-blue-500 rounded-full flex items-center justify-center">
                            <Check className="w-4 h-4 text-white" />
                          </div>
                        )}
                      </div>
                      <div className="p-3">
                        <div className="flex items-center justify-between mb-1">
                          <p className="font-bold text-sm text-slate-900 dark:text-white">
                            {proposal.name}
                          </p>
                          <span
                            className="w-4 h-4 rounded-full border border-slate-200"
                            style={{ backgroundColor: proposal.primaryColor }}
                          />
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed line-clamp-2">
                          {proposal.description}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}</>
  );
}
