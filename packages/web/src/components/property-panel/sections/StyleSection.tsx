import { t } from '@/i18n';
import {
  AlignLeft,
  AlignHorizontalJustifyCenter,
  AlignRight,
  MoveUp,
  MoveDown,
  AlignVerticalJustifyCenter,
} from 'lucide-react';
import { rgbToHex } from '../format';
import { DescriptorNumberInput } from '../descriptor-inputs';
import { propertyDescriptorMap } from '@/constants/propertyDescriptors';
import type { PropertyPanelSharedProps } from './types';

// 视觉/尺寸区块：图片对齐、尺寸（含保持纵横比）、玻璃/圆角/阴影/边框等视觉样式（L1.5）。
// 原 PropertyPanel 中 elementType==='image' 对齐段、尺寸段、视觉样式段三段连续 JSX 整块迁移。
export function StyleSection(props: PropertyPanelSharedProps) {
  const {
    elementType,
    selectedElements,
    localStyles,
    descriptorValues,
    mixedKeys,
    updaters,
    setDescriptorValue,
    setLocalStyles,
    keepAspectRatio,
    onKeepAspectRatioChange,
    onAlignSingle,
    isTextEditing,
    allTextElements,
    isMultiSelect,
  } = props;

  return (
    <>
      {!isTextEditing && elementType === 'image' && (
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-2">{t('图片对齐')}</label>
          <div className="grid grid-cols-3 gap-1 mb-2">
            <button
              onClick={() => onAlignSingle?.('left')}
              className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              title={t('左对齐')}
            >
              <AlignLeft className="w-4 h-4 text-slate-600 mx-auto" />
            </button>
            <button
              onClick={() => onAlignSingle?.('center-h')}
              className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              title={t('水平居中')}
            >
              <AlignHorizontalJustifyCenter className="w-4 h-4 text-slate-600 mx-auto" />
            </button>
            <button
              onClick={() => onAlignSingle?.('right')}
              className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              title={t('右对齐')}
            >
              <AlignRight className="w-4 h-4 text-slate-600 mx-auto" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1">
            <button
              onClick={() => onAlignSingle?.('top')}
              className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              title={t('上对齐')}
            >
              <MoveUp className="w-4 h-4 text-slate-600 mx-auto" />
            </button>
            <button
              onClick={() => onAlignSingle?.('center-v')}
              className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              title={t('垂直居中')}
            >
              <AlignVerticalJustifyCenter className="w-4 h-4 text-slate-600 mx-auto" />
            </button>
            <button
              onClick={() => onAlignSingle?.('bottom')}
              className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              title={t('下对齐')}
            >
              <MoveDown className="w-4 h-4 text-slate-600 mx-auto" />
            </button>
          </div>
        </div>
      )}

      {!isTextEditing && selectedElements.length > 0 && !allTextElements && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-xs font-medium text-slate-600">{t('尺寸')}</label>
            {!isMultiSelect && (
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={keepAspectRatio}
                  onChange={(e) => onKeepAspectRatioChange?.(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-xs text-slate-500">{t('保持纵横比')}</span>
              </label>
            )}
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 w-8">{t('宽度')}</span>
              <input
                type="number"
                value={Math.round(parseFloat(localStyles.width || '0'))}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (!isNaN(val)) {
                    updaters.updateWidth(val);
                  }
                }}
                onBlur={updaters.handleWidthBlur}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                className="flex-1 px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <span className="text-xs text-slate-400 w-6">px</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 w-8">{t('高度')}</span>
              <input
                type="number"
                value={Math.round(parseFloat(localStyles.height || '0'))}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (!isNaN(val)) {
                    updaters.updateHeight(val);
                  }
                }}
                onBlur={updaters.handleHeightBlur}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                className="flex-1 px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <span className="text-xs text-slate-400 w-6">px</span>
            </div>
          </div>
        </div>
      )}

      {!isTextEditing && selectedElements.length > 0 && !allTextElements && (
        <div className="pt-3 border-t border-slate-200">
          <label className="block text-xs font-medium text-slate-600 mb-2">
            {t('视觉样式（L1.5）')}
          </label>
          <div className="space-y-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs text-slate-500 w-14 shrink-0">{t('背景色')}</span>
                <input
                  type="color"
                  value={rgbToHex(
                    descriptorValues.backgroundColor || localStyles.backgroundColor || '#ffffff',
                  )}
                  onChange={(e) => {
                    const v = e.target.value;
                    setDescriptorValue('backgroundColor', v);
                    setLocalStyles((prev) => ({ ...prev, backgroundColor: v }));
                  }}
                  className="w-8 h-8 rounded-md cursor-pointer border border-slate-200 shrink-0"
                />
                <span className="text-[10px] text-slate-400 font-mono truncate">
                  {mixedKeys.has('backgroundColor')
                    ? t('混合')
                    : rgbToHex(
                        descriptorValues.backgroundColor ||
                          localStyles.backgroundColor ||
                          '#ffffff',
                      )}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 w-14 shrink-0">{t('圆角')}</span>
              <DescriptorNumberInput
                descriptor={propertyDescriptorMap.borderRadius}
                value={descriptorValues.borderRadius || localStyles.borderRadius || ''}
                mixed={mixedKeys.has('borderRadius')}
                onValueChange={(v) => {
                  setDescriptorValue('borderRadius', v);
                  setLocalStyles((prev) => ({ ...prev, borderRadius: v }));
                }}
                inputClassName="flex-1 px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 w-14 shrink-0">{t('边框粗细')}</span>
              <input
                type="number"
                min={0}
                max={20}
                value={parseFloat(localStyles.border || '0') || 0}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  const val = isNaN(v) ? 0 : Math.max(0, v);
                  const cur = localStyles.border || '0px';
                  const colorMatch = (cur || '').match(/#[0-9a-f]{6}|rgba?\([^)]*\)|rgb\([^)]*\)/i);
                  const color = colorMatch ? colorMatch[0] : '#e2e8f0';
                  const styleMatch = (cur || '').match(/\b(solid|dashed|dotted|double)\b/i);
                  const style = styleMatch ? styleMatch[0] : 'solid';
                  updaters.updateStyle('border', `${val}px ${style} ${color}`);
                }}
                className="flex-1 px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <span className="text-xs text-slate-400 w-6">px</span>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs text-slate-500 w-14 shrink-0">{t('阴影')}</span>
                <select
                  value={
                    localStyles.boxShadow
                      ? localStyles.boxShadow.includes('0 4px 12px')
                        ? 'md'
                        : localStyles.boxShadow.includes('0 8px 32px')
                          ? 'lg'
                          : localStyles.boxShadow.includes('0 1px 4px')
                            ? 'sm'
                            : 'custom'
                      : 'none'
                  }
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === 'none') updaters.updateStyle('boxShadow', '');
                    else if (val === 'sm')
                      updaters.updateStyle('boxShadow', '0 1px 4px rgba(0,0,0,0.08)');
                    else if (val === 'md')
                      updaters.updateStyle('boxShadow', '0 4px 12px rgba(0,0,0,0.1)');
                    else if (val === 'lg')
                      updaters.updateStyle('boxShadow', '0 8px 32px rgba(0,0,0,0.12)');
                  }}
                  className="flex-1 px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                >
                  <option value="none">{t('无')}</option>
                  <option value="sm">{t('小')}</option>
                  <option value="md">{t('中')}</option>
                  <option value="lg">{t('大')}</option>
                  {localStyles.boxShadow &&
                    !['0 1px 4px', '0 4px 12px', '0 8px 32px'].some((p) =>
                      localStyles.boxShadow.includes(p),
                    ) && <option value="custom">{t('自定义')}</option>}
                </select>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs text-slate-500 w-14 shrink-0">{t('玻璃模糊')}</span>
                <input
                  type="number"
                  min={0}
                  max={40}
                  placeholder={t('0 (无)')}
                  value={
                    localStyles.backdropFilter
                      ? parseFloat(
                          localStyles.backdropFilter.match(/blur\((\d+(?:\.\d+)?)px\)/)?.[1] || '0',
                        )
                      : 0
                  }
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    const px = isNaN(v) ? 0 : Math.max(0, v);
                    if (px === 0) {
                      updaters.updateStyle('backdropFilter', '');
                      selectedElements.forEach((el) => {
                        (el.style as any).webkitBackdropFilter = '';
                      });
                    } else {
                      const blurVal = `blur(${px}px)`;
                      updaters.updateStyle('backdropFilter', blurVal);
                      selectedElements.forEach((el) => {
                        (el.style as any).webkitBackdropFilter = blurVal;
                      });
                    }
                  }}
                  className="flex-1 px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <span className="text-xs text-slate-400 w-6">px</span>
              </div>
              <p className="text-[10px] text-slate-400 ml-14">
                {t('开启后建议将"背景色"透明度调为 0.4~0.7（例如 rgba(255,255,255,0.55)）')}
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
