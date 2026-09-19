import { t } from '@/i18n';
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  AlignHorizontalJustifyCenter,
  AlignVerticalJustifyCenter,
  MoveUp,
  MoveDown,
  ArrowLeftRight,
  ArrowUpDown,
} from 'lucide-react';
import type { PropertyPanelSharedProps } from './types';

// 多选元素排列区块（原 PropertyPanel 顶部「元素排列」）。
export function AlignSection(props: PropertyPanelSharedProps) {
  const { isMultiSelect, onAlign } = props;
  if (!isMultiSelect || !onAlign) return null;
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-2">{t('元素排列')}</label>
      <div className="grid grid-cols-4 gap-1 mb-2">
        <button
          onClick={() => onAlign('left')}
          className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          title={t('左对齐')}
        >
          <AlignLeft className="w-4 h-4 text-slate-600 mx-auto" />
        </button>
        <button
          onClick={() => onAlign('center-h')}
          className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          title={t('水平居中')}
        >
          <AlignHorizontalJustifyCenter className="w-4 h-4 text-slate-600 mx-auto" />
        </button>
        <button
          onClick={() => onAlign('right')}
          className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          title={t('右对齐')}
        >
          <AlignRight className="w-4 h-4 text-slate-600 mx-auto" />
        </button>
        <button
          onClick={() => onAlign('distribute-h')}
          className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          title={t('水平等间距')}
        >
          <ArrowLeftRight className="w-4 h-4 text-slate-600 mx-auto" />
        </button>
      </div>
      <div className="grid grid-cols-4 gap-1">
        <button
          onClick={() => onAlign('top')}
          className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          title={t('上对齐')}
        >
          <MoveUp className="w-4 h-4 text-slate-600 mx-auto" />
        </button>
        <button
          onClick={() => onAlign('center-v')}
          className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          title={t('垂直居中')}
        >
          <AlignVerticalJustifyCenter className="w-4 h-4 text-slate-600 mx-auto" />
        </button>
        <button
          onClick={() => onAlign('bottom')}
          className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          title={t('下对齐')}
        >
          <MoveDown className="w-4 h-4 text-slate-600 mx-auto" />
        </button>
        <button
          onClick={() => onAlign('distribute-v')}
          className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          title={t('垂直等间距')}
        >
          <ArrowUpDown className="w-4 h-4 text-slate-600 mx-auto" />
        </button>
      </div>
    </div>
  );
}
