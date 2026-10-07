import { AlertTriangle, ChevronDown, ChevronUp, Database, RotateCcw } from 'lucide-react';
import { t } from '@/i18n';

interface ReferenceMaterialSectionProps {
  showReference: boolean;
  setShowReference: (value: boolean) => void;
  referenceText: string;
  referenceSource?: string;
  referenceTruncated: boolean;
  referenceOriginalChars: number;
  referenceInitial: string;
  updateReferenceText: (value: string) => void;
  effectiveReferenceLimit: number;
  referenceOverLimit: boolean;
}

export function ReferenceMaterialSection({
  showReference,
  setShowReference,
  referenceText,
  referenceSource,
  referenceTruncated,
  referenceOriginalChars,
  referenceInitial,
  updateReferenceText,
  effectiveReferenceLimit,
  referenceOverLimit,
}: ReferenceMaterialSectionProps) {
  return (
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
              {referenceText.length.toLocaleString()} / {effectiveReferenceLimit.toLocaleString()}
              {t('字')}
            </span>
          ) : (
            <span className="text-[11px] text-slate-400 dark:text-slate-500">{t('未注入')}</span>
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
            onChange={(event) => updateReferenceText(event.target.value)}
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
              {referenceText.length.toLocaleString()} / {effectiveReferenceLimit.toLocaleString()}
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
  );
}
