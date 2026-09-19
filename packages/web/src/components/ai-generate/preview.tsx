/**
 * AIGenerateModal 的展示型子组件（由 AIGenerateModal.tsx 逐字节搬移）。
 * - Stepper：顶部流程步骤条
 * - HtmlPreview：HTML 幻灯片预览容器（支持 fit 自适应缩放）
 */
import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { t } from '@/i18n';
import { safeHtml } from '@/utils/security';
import type { PipelineStage } from './types';

export function Stepper({ currentStage }: { currentStage: PipelineStage }) {
  const steps = [
    { key: 'outline', label: t('大纲') },
    { key: 'design', label: t('设计方案') },
    { key: 'layout-preview', label: t('页面预览') },
    { key: 'generating', label: t('生成') },
  ];
  const stageOrder: PipelineStage[] = ['outline', 'design', 'layout-preview', 'generating', 'done'];
  const currentIdx = stageOrder.indexOf(currentStage);
  return (
    <div className="flex items-center justify-center gap-1 sm:gap-2 mb-4">
      {steps.map((s, i) => {
        const stepIdx = stageOrder.indexOf(s.key as PipelineStage);
        const isDone = currentIdx > stepIdx || currentStage === 'done';
        const isCurrent = currentStage === s.key;
        return (
          <div key={s.key} className="flex items-center gap-1 sm:gap-2">
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                isDone
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                  : isCurrent
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                    : 'bg-slate-100 text-slate-400 dark:bg-slate-700/50 dark:text-slate-500'
              }`}
            >
              <span
                className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] ${
                  isDone
                    ? 'bg-green-500 text-white'
                    : isCurrent
                      ? 'bg-blue-500 text-white'
                      : 'bg-slate-300 dark:bg-slate-600 text-white'
                }`}
              >
                {isDone ? <Check className="w-3 h-3" /> : i + 1}
              </span>
              <span className="hidden sm:inline">{s.label}</span>
            </div>
            {i < steps.length - 1 && (
              <div
                className={`w-4 sm:w-8 h-0.5 rounded ${isDone ? 'bg-green-400' : 'bg-slate-200 dark:bg-slate-700'}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function HtmlPreview({
  html,
  scale,
  width = 1280,
  height = 720,
  fit = false,
}: {
  html: string;
  scale?: number;
  width?: number;
  height?: number;
  fit?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScale, setAutoScale] = useState(0.25);
  useEffect(() => {
    if (!fit || !containerRef.current) return;
    const el = containerRef.current;
    const update = () => {
      const w = el.clientWidth;
      if (w > 0) setAutoScale(w / width);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit, width]);
  const effectiveScale = fit ? autoScale : (scale ?? 0.25);
  return (
    <div
      ref={containerRef}
      className="overflow-hidden relative bg-white"
      style={
        fit
          ? { width: '100%', aspectRatio: `${width} / ${height}` }
          : { width: width * effectiveScale, height: height * effectiveScale }
      }
    >
      <div
        style={{
          width,
          height,
          transform: `scale(${effectiveScale})`,
          transformOrigin: 'top left',
        }}
        dangerouslySetInnerHTML={safeHtml(html)}
      />
    </div>
  );
}
