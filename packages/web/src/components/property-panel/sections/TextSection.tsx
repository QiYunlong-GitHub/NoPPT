import { t } from '@/i18n';
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  Minus,
  Sparkles,
  PenTool,
  Square,
  Hash,
  Smile,
  Scissors,
  Type,
} from 'lucide-react';
import { FONT_LIST, matchFontFamily, rgbToHex } from '../format';
import { DescriptorNumberInput, DescriptorColorInput } from '../descriptor-inputs';
import { propertyDescriptorMap } from '@/constants/propertyDescriptors';
import { parseNumberValue } from '@/utils/styleProperties';
import type { IconStyle } from '@/utils/iconReplacer';
import type { PropertyPanelSharedProps } from './types';

// 文本相关区块：文本编辑模式（字体/字号/样式/对齐/颜色/列表图标/拆分）
// 与「非编辑态文字元素」属性（字体/字号/样式/颜色/对齐）。
// 原 PropertyPanel 内 isTextEditing 与 !isTextEditing&&(text||allText) 两段连续 JSX 整块迁移。
export function TextSection(props: PropertyPanelSharedProps) {
  const {
    isTextEditing,
    selectedElements,
    selectionStyles,
    elementType,
    allTextElements,
    localStyles,
    descriptorValues,
    mixedKeys,
    updaters,
    setDescriptorValue,
    setLocalStyles,
    onSelectionFontFamily,
    onSelectionFontSize,
    onSelectionBold,
    onSelectionItalic,
    onSelectionUnderline,
    onSelectionStrikethrough,
    onSelectionAlign,
    onSelectionUnorderedList,
    onSelectionOrderedList,
    selectionListType,
    selectionListStyleType,
    bulletStyles,
    onSelectionListStyleType,
    onSelectionListWithStyle,
    onSelectionIconStyle,
    numberStyles,
    onSplitText,
  } = props;

  return (
    <>
      {isTextEditing && (
        <>
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg mb-4">
            <p className="text-xs text-blue-700 text-center font-medium">
              {t('文本编辑模式 - 选中文字后调整格式')}
            </p>
            <p className="text-xs text-blue-600 text-center mt-1">
              {t('按 ESC 或点击外部退出编辑')}
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2">{t('字体')}</label>
            <select
              value={
                selectionStyles?.fontFamily ? matchFontFamily(selectionStyles.fontFamily) : ''
              }
              onChange={(e) => onSelectionFontFamily?.(e.target.value)}
              disabled={!selectionStyles}
              className="w-full text-sm text-slate-700 px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed bg-white"
            >
              <option value="">{t('选中文本')}</option>
              {FONT_LIST.map((font) => (
                <option key={font.value} value={font.value}>
                  {font.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2">
              {t('字号')}
              {selectionStyles ? `(${parseFloat(selectionStyles.fontSize)}px)` : ''}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={selectionStyles ? parseFloat(selectionStyles.fontSize) : ''}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (!isNaN(val) && val > 0 && onSelectionFontSize) {
                    onSelectionFontSize(val);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                placeholder={t('选中文本')}
                className="flex-1 text-center text-sm text-slate-700 font-medium px-2 py-1 border border-slate-200 rounded focus:outline-none focus:border-blue-500"
                min="1"
                disabled={!selectionStyles}
              />
              <span className="text-xs text-slate-400 w-6">px</span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2">
              {t('文字样式')}
            </label>
            <div className="grid grid-cols-4 gap-2">
              <button
                onClick={() => onSelectionBold?.()}
                disabled={!selectionStyles}
                className={`py-2 rounded-lg text-sm font-bold transition-colors ${
                  selectionStyles?.fontWeight === '700' || selectionStyles?.fontWeight === 'bold'
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                } ${!selectionStyles ? 'opacity-50 cursor-not-allowed' : ''}`}
                title={t('加粗')}
              >
                <Bold className="w-4 h-4 mx-auto" />
              </button>
              <button
                onClick={() => onSelectionItalic?.()}
                disabled={!selectionStyles}
                className={`py-2 rounded-lg text-sm italic transition-colors ${
                  selectionStyles?.fontStyle === 'italic'
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                } ${!selectionStyles ? 'opacity-50 cursor-not-allowed' : ''}`}
                title={t('斜体')}
              >
                <Italic className="w-4 h-4 mx-auto" />
              </button>
              <button
                onClick={() => onSelectionUnderline?.()}
                disabled={!selectionStyles}
                className={`py-2 rounded-lg text-sm underline transition-colors ${
                  selectionStyles?.textDecoration?.includes('underline')
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                } ${!selectionStyles ? 'opacity-50 cursor-not-allowed' : ''}`}
                title={t('下划线')}
              >
                <Underline className="w-4 h-4 mx-auto" />
              </button>
              <button
                onClick={() => onSelectionStrikethrough?.()}
                disabled={!selectionStyles}
                className={`py-2 rounded-lg text-sm line-through transition-colors ${
                  selectionStyles?.textDecoration?.includes('line-through')
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                } ${!selectionStyles ? 'opacity-50 cursor-not-allowed' : ''}`}
                title={t('删除线')}
              >
                <Strikethrough className="w-4 h-4 mx-auto" />
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2">
              {t('对齐方式')}
            </label>
            <div className="grid grid-cols-4 gap-2">
              <button
                onClick={() => onSelectionAlign?.('left')}
                disabled={!selectionStyles}
                className={`py-2 rounded-lg transition-colors ${
                  selectionStyles?.textAlign === 'left'
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                } ${!selectionStyles ? 'opacity-50 cursor-not-allowed' : ''}`}
                title={t('左对齐')}
              >
                <AlignLeft className="w-4 h-4 mx-auto" />
              </button>
              <button
                onClick={() => onSelectionAlign?.('center')}
                disabled={!selectionStyles}
                className={`py-2 rounded-lg transition-colors ${
                  selectionStyles?.textAlign === 'center'
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                } ${!selectionStyles ? 'opacity-50 cursor-not-allowed' : ''}`}
                title={t('居中对齐')}
              >
                <AlignCenter className="w-4 h-4 mx-auto" />
              </button>
              <button
                onClick={() => onSelectionAlign?.('right')}
                disabled={!selectionStyles}
                className={`py-2 rounded-lg transition-colors ${
                  selectionStyles?.textAlign === 'right'
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                } ${!selectionStyles ? 'opacity-50 cursor-not-allowed' : ''}`}
                title={t('右对齐')}
              >
                <AlignRight className="w-4 h-4 mx-auto" />
              </button>
              <button
                onClick={() => onSelectionAlign?.('justify')}
                disabled={!selectionStyles}
                className={`py-2 rounded-lg transition-colors ${
                  selectionStyles?.textAlign === 'justify'
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                } ${!selectionStyles ? 'opacity-50 cursor-not-allowed' : ''}`}
                title={t('两端对齐')}
              >
                <AlignJustify className="w-4 h-4 mx-auto" />
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2">
              {t('文字颜色')}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={selectionStyles ? rgbToHex(selectionStyles.color) : '#000000'}
                onChange={(e) => props.onSelectionColor?.(e.target.value)}
                disabled={!selectionStyles}
                className="w-10 h-10 rounded-lg cursor-pointer border border-slate-200 disabled:opacity-50"
              />
              <span className="text-xs text-slate-500 font-mono">
                {selectionStyles ? rgbToHex(selectionStyles.color) : t('未选中文本')}
              </span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2">
              {t('背景颜色')}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={
                  selectionStyles?.backgroundColor
                    ? rgbToHex(selectionStyles.backgroundColor)
                    : '#ffffff'
                }
                onChange={(e) => props.onSelectionBackgroundColor?.(e.target.value)}
                disabled={!selectionStyles}
                className="w-10 h-10 rounded-lg cursor-pointer border border-slate-200 disabled:opacity-50"
              />
              <span className="text-xs text-slate-500 font-mono">
                {selectionStyles?.backgroundColor
                  ? rgbToHex(selectionStyles.backgroundColor)
                  : t('未选中文本')}
              </span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2">
              {isTextEditing ? t('列表符号') : t('图标风格')}
            </label>
            {isTextEditing ? (
              <>
                <div className="grid grid-cols-2 gap-1.5 mb-2">
                  <button
                    onClick={() => onSelectionUnorderedList?.()}
                    disabled={!selectionStyles}
                    className={`py-1.5 rounded-lg transition-colors flex items-center justify-center gap-1.5 text-xs font-medium ${
                      selectionListType === 'ul'
                        ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-300'
                        : !selectionStyles
                          ? 'bg-slate-100 text-slate-400 opacity-50 cursor-not-allowed'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    <List className="w-3.5 h-3.5" />
                    {t('项目符号')}
                  </button>
                  <button
                    onClick={() => onSelectionOrderedList?.()}
                    disabled={!selectionStyles}
                    className={`py-1.5 rounded-lg transition-colors flex items-center justify-center gap-1.5 text-xs font-medium ${
                      selectionListType === 'ol'
                        ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-300'
                        : !selectionStyles
                          ? 'bg-slate-100 text-slate-400 opacity-50 cursor-not-allowed'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    <ListOrdered className="w-3.5 h-3.5" />
                    {t('项目编号')}
                  </button>
                </div>

                {selectionListType === 'ul' && bulletStyles && (
                  <div className="grid grid-cols-4 gap-1">
                    {Object.entries(bulletStyles).map(([key, { symbol, label }]) => (
                      <button
                        key={key}
                        onClick={() => {
                          if (key === 'none') {
                            onSelectionListStyleType?.(key);
                          } else if (onSelectionListWithStyle) {
                            onSelectionListWithStyle('ul', key);
                          } else {
                            onSelectionListStyleType?.(key);
                          }
                        }}
                        disabled={!selectionStyles}
                        title={label}
                        className={`py-2 rounded-lg transition-colors flex items-center justify-center text-base ${
                          selectionListStyleType === key
                            ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-400'
                            : !selectionStyles
                              ? 'bg-slate-50 text-slate-300 cursor-not-allowed'
                              : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {symbol || <Minus className="w-3.5 h-3.5 text-slate-400" />}
                      </button>
                    ))}
                  </div>
                )}

                {selectionListType === 'ol' && numberStyles && (
                  <div className="grid grid-cols-3 gap-1">
                    {Object.entries(numberStyles).map(([key, { label }]) => (
                      <button
                        key={key}
                        onClick={() => {
                          if (key === 'none') {
                            onSelectionListStyleType?.(key);
                          } else if (onSelectionListWithStyle) {
                            onSelectionListWithStyle('ol', key);
                          } else {
                            onSelectionListStyleType?.(key);
                          }
                        }}
                        disabled={!selectionStyles}
                        title={label}
                        className={`py-1.5 px-1 rounded-lg transition-colors flex items-center justify-center text-xs font-medium ${
                          selectionListStyleType === key
                            ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-400'
                            : !selectionStyles
                              ? 'bg-slate-50 text-slate-300 cursor-not-allowed'
                              : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}

                {!selectionListType && (
                  <p className="text-xs text-slate-400 text-center py-1">
                    {t('点击上方按钮添加列表，或选中已存在的列表行')}
                  </p>
                )}
              </>
            ) : (
              <div className="grid grid-cols-4 gap-1.5">
                {[
                  { id: 'auto' as IconStyle, icon: Sparkles, label: t('智能') },
                  { id: 'line' as IconStyle, icon: PenTool, label: t('线性') },
                  { id: 'filled' as IconStyle, icon: Square, label: t('面性') },
                  { id: 'numbered' as IconStyle, icon: Hash, label: t('数字') },
                  { id: 'bullet' as IconStyle, icon: List, label: t('对勾') },
                  { id: 'lettered' as IconStyle, icon: Type, label: t('字母') },
                  { id: 'emoji' as IconStyle, icon: Smile, label: 'Emoji' },
                  { id: 'none' as IconStyle, icon: Minus, label: t('无') },
                ].map(({ id, icon: IconComp, label }) => (
                  <button
                    key={id}
                    onClick={() => onSelectionIconStyle?.(id)}
                    disabled={!selectedElements || selectedElements.length === 0}
                    className={`py-2 rounded-lg transition-colors flex flex-col items-center justify-center gap-1 text-xs ${
                      !selectedElements || selectedElements.length === 0
                        ? 'bg-slate-100 text-slate-400 opacity-50 cursor-not-allowed'
                        : 'bg-slate-100 text-slate-600 hover:bg-blue-50 hover:text-blue-600'
                    }`}
                    title={label}
                  >
                    <IconComp className="w-4 h-4" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {onSplitText && (
            <div className="pt-3 border-t border-slate-200">
              <button
                onClick={onSplitText}
                disabled={!selectionStyles}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-orange-50 text-orange-600 hover:bg-orange-100 rounded-lg transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Scissors className="w-4 h-4" />
                {t('拆分为独立元素')}
              </button>
              <p className="text-xs text-slate-400 text-center mt-2">
                {t('选中文字后点击，将其从父元素中分离')}
              </p>
            </div>
          )}
        </>
      )}

      {!isTextEditing && (elementType === 'text' || allTextElements) && (
        <>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2">{t('字体')}</label>
            <select
              value={localStyles.fontFamily ? matchFontFamily(localStyles.fontFamily) : ''}
              onChange={(e) => updaters.adjustFontFamilyTo(e.target.value)}
              className="w-full text-sm text-slate-700 px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 bg-white"
            >
              {FONT_LIST.map((font) => (
                <option key={font.value} value={font.value}>
                  {font.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2">{t('字号')}</label>
            <DescriptorNumberInput
              descriptor={propertyDescriptorMap.fontSize}
              value={descriptorValues.fontSize || localStyles.fontSize}
              mixed={mixedKeys.has('fontSize')}
              onValueChange={(v) => {
                const num = parseNumberValue(v, 'px');
                updaters.adjustFontSizeTo(num);
              }}
              onNumberChange={(num) => updaters.adjustFontSizeTo(num)}
              onAdjust={(delta) => updaters.adjustFontSize(delta)}
              showSteppers
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2">
              {t('文字样式')}
            </label>
            <div className="grid grid-cols-4 gap-2">
              <button
                onClick={() => {
                  const current = descriptorValues.fontWeight || localStyles.fontWeight;
                  const isBold = current === '700' || current === 'bold';
                  const next = isBold ? '400' : '700';
                  setDescriptorValue('fontWeight', next);
                  setLocalStyles((prev) => ({ ...prev, fontWeight: next }));
                }}
                className={`py-2 rounded-lg text-sm font-bold transition-colors ${
                  (descriptorValues.fontWeight || localStyles.fontWeight) === '700' ||
                  (descriptorValues.fontWeight || localStyles.fontWeight) === 'bold'
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
                title={t('加粗')}
              >
                <Bold className="w-4 h-4 mx-auto" />
              </button>
              <button
                onClick={() => {
                  const current = descriptorValues.fontStyle || localStyles.fontStyle;
                  const isItalic = current === 'italic';
                  const next = isItalic ? 'normal' : 'italic';
                  setDescriptorValue('fontStyle', next);
                  setLocalStyles((prev) => ({ ...prev, fontStyle: next }));
                }}
                className={`py-2 rounded-lg text-sm italic transition-colors ${
                  (descriptorValues.fontStyle || localStyles.fontStyle) === 'italic'
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
                title={t('斜体')}
              >
                <Italic className="w-4 h-4 mx-auto" />
              </button>
              <button
                onClick={() => {
                  const current =
                    descriptorValues.textDecoration || localStyles.textDecoration || '';
                  const hasUnderline = current.includes('underline');
                  const currentDecorations = current
                    ? current.split(' ').filter((d) => d && d !== 'none')
                    : [];
                  let newDecorations: string[];
                  if (hasUnderline) {
                    newDecorations = currentDecorations.filter((d) => d !== 'underline');
                  } else {
                    newDecorations = [...currentDecorations, 'underline'];
                  }
                  const next = newDecorations.join(' ') || 'none';
                  setDescriptorValue('textDecoration', next);
                  setLocalStyles((prev) => ({ ...prev, textDecoration: next }));
                }}
                className={`py-2 rounded-lg text-sm underline transition-colors ${
                  (descriptorValues.textDecoration || localStyles.textDecoration)?.includes(
                    'underline',
                  )
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
                title={t('下划线')}
              >
                <Underline className="w-4 h-4 mx-auto" />
              </button>
              <button
                onClick={() => {
                  const current =
                    descriptorValues.textDecoration || localStyles.textDecoration || '';
                  const hasLineThrough = current.includes('line-through');
                  const currentDecorations = current
                    ? current.split(' ').filter((d) => d && d !== 'none')
                    : [];
                  let newDecorations: string[];
                  if (hasLineThrough) {
                    newDecorations = currentDecorations.filter((d) => d !== 'line-through');
                  } else {
                    newDecorations = [...currentDecorations, 'line-through'];
                  }
                  const next = newDecorations.join(' ') || 'none';
                  setDescriptorValue('textDecoration', next);
                  setLocalStyles((prev) => ({ ...prev, textDecoration: next }));
                }}
                className={`py-2 rounded-lg text-sm line-through transition-colors ${
                  (descriptorValues.textDecoration || localStyles.textDecoration)?.includes(
                    'line-through',
                  )
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
                title={t('删除线')}
              >
                <Strikethrough className="w-4 h-4 mx-auto" />
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2">
              {t('文字颜色')}
            </label>
            <DescriptorColorInput
              descriptor={propertyDescriptorMap.color}
              value={descriptorValues.color || localStyles.color || ''}
              mixed={mixedKeys.has('color')}
              onValueChange={(v) => {
                setDescriptorValue('color', v);
                setLocalStyles((prev) => ({ ...prev, color: v }));
              }}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2">
              {t('背景颜色')}
            </label>
            <DescriptorColorInput
              descriptor={propertyDescriptorMap.backgroundColor}
              value={descriptorValues.backgroundColor || localStyles.backgroundColor || ''}
              mixed={mixedKeys.has('backgroundColor')}
              onValueChange={(v) => {
                setDescriptorValue('backgroundColor', v);
                setLocalStyles((prev) => ({ ...prev, backgroundColor: v }));
              }}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2">
              {t('对齐方式')}
            </label>
            <div className="grid grid-cols-4 gap-2">
              {(['left', 'center', 'right', 'justify'] as const).map((align) => {
                const currentAlign = descriptorValues.textAlign || localStyles.textAlign;
                return (
                  <button
                    key={align}
                    onClick={() => {
                      setDescriptorValue('textAlign', align);
                      setLocalStyles((prev) => ({ ...prev, textAlign: align }));
                    }}
                    className={`py-2 rounded-lg transition-colors ${
                      currentAlign === align
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                    title={
                      align === 'left'
                        ? t('左对齐')
                        : align === 'center'
                          ? t('居中对齐')
                          : align === 'right'
                            ? t('右对齐')
                            : t('两端对齐')
                    }
                  >
                    {align === 'left' && <AlignLeft className="w-4 h-4 mx-auto" />}
                    {align === 'center' && <AlignCenter className="w-4 h-4 mx-auto" />}
                    {align === 'right' && <AlignRight className="w-4 h-4 mx-auto" />}
                    {align === 'justify' && <AlignJustify className="w-4 h-4 mx-auto" />}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </>
  );
}
