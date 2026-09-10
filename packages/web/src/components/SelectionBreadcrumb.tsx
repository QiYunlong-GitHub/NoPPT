import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { t } from '@/i18n';

interface SelectionBreadcrumbProps {
  selectedElement: HTMLElement | null;
  onSelectElement: (el: HTMLElement) => void;
  onSelectSlide?: () => void;
}

const ELEMENT_TYPE_LABELS: Record<string, string> = {
  text: '文本',
  image: '图片',
  shape: '形状',
  group: '组',
  table: '表格',
  video: '视频',
  icon: '图标',
};

const TAG_LABELS: Record<string, string> = {
  div: '容器',
  section: '容器',
  article: '容器',
  span: '文本',
  p: '文本',
  h1: '标题',
  h2: '标题',
  h3: '标题',
  h4: '标题',
  h5: '标题',
  h6: '标题',
  img: '图片',
  table: '表格',
  video: '视频',
  ul: '列表',
  ol: '列表',
  li: '列表项',
  button: '按钮',
  a: '链接',
  strong: '文本',
  em: '文本',
  b: '文本',
  i: '文本',
  td: '单元格',
  th: '表头',
  tr: '行',
  thead: '表头',
  tbody: '表体',
  figure: '图片',
  figcaption: '图注',
};

const CLASS_HINTS: Array<{ className: string; label: string }> = [
  { className: 'noppt-text-element', label: '文本' },
  { className: 'noppt-group-element', label: '组' },
  { className: 'noppt-slide-image-element', label: '图片' },
  { className: 'noppt-table-element', label: '表格' },
];

function getElementLabel(el: HTMLElement): string {
  const dataType = el.getAttribute('data-element-type');
  if (dataType && ELEMENT_TYPE_LABELS[dataType]) {
    return ELEMENT_TYPE_LABELS[dataType];
  }

  for (const hint of CLASS_HINTS) {
    if (el.classList.contains(hint.className)) {
      return hint.label;
    }
  }

  const tag = el.tagName.toLowerCase();
  if (TAG_LABELS[tag]) {
    return TAG_LABELS[tag];
  }

  return tag;
}

function buildAncestorChain(startEl: HTMLElement): HTMLElement[] {
  const chain: HTMLElement[] = [];
  let current: HTMLElement | null = startEl;

  while (current) {
    if (current.getAttribute('data-slide-content') === 'true') {
      break;
    }
    chain.push(current);
    current = current.parentElement;
  }

  return chain.reverse();
}

export default function SelectionBreadcrumb({
  selectedElement,
  onSelectElement,
  onSelectSlide,
}: SelectionBreadcrumbProps) {
  const [chain, setChain] = useState<HTMLElement[]>([]);

  useEffect(() => {
    if (!selectedElement) {
      setChain([]);
      return;
    }
    setChain(buildAncestorChain(selectedElement));
  }, [selectedElement]);

  if (!selectedElement || chain.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-0.5 px-3 py-1.5 bg-slate-50 border-b border-slate-200 overflow-x-auto shrink-0 min-h-[32px]">
      <button
        onClick={() => {
          if (onSelectSlide) {
            onSelectSlide();
          } else {
            const slideContent = selectedElement.closest('[data-slide-content="true"]') as HTMLElement | null;
            if (slideContent) {
              onSelectElement(slideContent);
            }
          }
        }}
        className="shrink-0 px-1.5 py-0.5 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-200/60 rounded transition-colors"
        title={t('幻灯片')}
      >
        {t('幻灯片')}
      </button>
      {chain.map((el, index) => {
        const isLast = index === chain.length - 1;
        const label = getElementLabel(el);
        return (
          <div key={index} className="flex items-center shrink-0">
            <ChevronRight className="w-3 h-3 text-slate-400 shrink-0" />
            <button
              onClick={() => onSelectElement(el)}
              className={`shrink-0 px-1.5 py-0.5 text-xs rounded transition-colors max-w-[120px] truncate ${
                isLast
                  ? 'text-blue-600 bg-blue-100 font-medium'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/60'
              }`}
              title={t(label)}
            >
              {t(label)}
            </button>
          </div>
        );
      })}
    </div>
  );
}
