import { t } from '@/i18n';
import { useState, useRef } from 'react';
import { X, Type, Image, Layers } from 'lucide-react';
import type { IconStyle } from '@/utils/iconReplacer';
import { propertyDescriptors } from '@/constants/propertyDescriptors';
import { usePropertyValues } from '@/hooks/usePropertyValues';
import { useComputedStyleSync } from './property-panel/useComputedStyleSync';
import { createPropertyUpdaters } from './property-panel/updaters';
import {
  AlignSection,
  TextSection,
  StyleSection,
  LayoutSection,
  type PropertyPanelSharedProps,
} from './property-panel/sections';

interface PropertyPanelProps {
  selectedElements: HTMLElement[];
  onClose: () => void;
  onDelete: () => void;
  onChange: () => void;
  onAlign?: (
    type:
      | 'left'
      | 'right'
      | 'top'
      | 'bottom'
      | 'center-h'
      | 'center-v'
      | 'distribute-h'
      | 'distribute-v'
      | 'center-slide-h'
      | 'center-slide-v',
  ) => void;
  onAlignSingle?: (
    type:
      | 'left'
      | 'right'
      | 'top'
      | 'bottom'
      | 'center-h'
      | 'center-v'
      | 'center-slide-h'
      | 'center-slide-v',
  ) => void;
  onMove?: (direction: 'up' | 'down' | 'left' | 'right', amount: number) => void;
  onCopy?: () => void;
  onCancelPaste?: () => void;
  onFormatBrush?: () => void;
  onSplitText?: () => void;
  onBringToFront?: () => void;
  onSendToBack?: () => void;
  onBringForward?: () => void;
  onSendBackward?: () => void;
  isPasteMode?: boolean;
  isFormatBrushMode?: boolean;
  isTextEditing?: boolean;
  keepAspectRatio?: boolean;
  onKeepAspectRatioChange?: (value: boolean) => void;
  selectionStyles?: {
    fontSize: string;
    fontWeight: string;
    fontStyle: string;
    textDecoration: string;
    color: string;
    backgroundColor: string;
    fontFamily: string;
    textAlign: string;
    lineHeight: string;
  } | null;
  onSelectionFontSize?: (size: number) => void;
  onSelectionBold?: () => void;
  onSelectionItalic?: () => void;
  onSelectionUnderline?: () => void;
  onSelectionStrikethrough?: () => void;
  onSelectionColor?: (color: string) => void;
  onSelectionBackgroundColor?: (color: string) => void;
  onSelectionFontFamily?: (font: string) => void;
  onSelectionAlign?: (align: 'left' | 'center' | 'right' | 'justify') => void;
  onSelectionUnorderedList?: () => void;
  onSelectionOrderedList?: () => void;
  onSelectionListStyleType?: (styleType: string) => void;
  onSelectionListWithStyle?: (listType: 'ul' | 'ol', styleType: string) => void;
  onSelectionIconStyle?: (style: IconStyle) => void;
  selectionListType?: 'ul' | 'ol' | null;
  selectionListStyleType?: string;
  bulletStyles?: Record<
    string,
    {
      symbol: string;
      label: string;
    }
  >;
  numberStyles?: Record<
    string,
    {
      formatter: (i: number) => string;
      label: string;
    }
  >;
}
export default function PropertyPanel({
  selectedElements,
  onClose,
  onDelete,
  onChange,
  onAlign,
  onAlignSingle,
  onMove,
  onCopy,
  onCancelPaste,
  onFormatBrush,
  onSplitText,
  onBringToFront,
  onSendToBack,
  onBringForward,
  onSendBackward,
  isPasteMode,
  isFormatBrushMode,
  isTextEditing,
  keepAspectRatio,
  onKeepAspectRatioChange,
  selectionStyles,
  onSelectionFontSize,
  onSelectionBold,
  onSelectionItalic,
  onSelectionUnderline,
  onSelectionStrikethrough,
  onSelectionColor,
  onSelectionBackgroundColor,
  onSelectionFontFamily,
  onSelectionAlign,
  onSelectionUnorderedList,
  onSelectionOrderedList,
  onSelectionListStyleType,
  onSelectionListWithStyle,
  onSelectionIconStyle,
  selectionListType,
  selectionListStyleType,
  bulletStyles,
  numberStyles,
}: PropertyPanelProps) {
  const [isMultiSelect, setIsMultiSelect] = useState(false);
  const [elementType, setElementType] = useState<'text' | 'image' | 'container' | 'mixed' | null>(
    null,
  );
  const [allTextElements, setAllTextElements] = useState(false);
  const [localStyles, setLocalStyles] = useState<Record<string, string>>({});
  const [aspectRatio, setAspectRatio] = useState(1);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const originalPositionRef = useRef({ left: 0, top: 0 });
  const slideContainerRef = useRef<Element | null>(null);
  const simplePropertyKeys = [
    'fontSize',
    'fontWeight',
    'fontStyle',
    'textDecoration',
    'color',
    'backgroundColor',
    'textAlign',
    'borderRadius',
    'opacity',
    'lineHeight',
    'letterSpacing',
  ];
  const simpleDescriptors = propertyDescriptors.filter((d) => simplePropertyKeys.includes(d.key));
  const {
    values: descriptorValues,
    setValue: setDescriptorValue,
    setNumberValue: setDescriptorNumber,
    getNumber: getDescriptorNumber,
    mixedKeys,
  } = usePropertyValues(selectedElements, simpleDescriptors, onChange);
  // 获取元素真实渲染尺寸（像素）。当 style width/height 为百分比时，优先用 getBoundingClientRect / zoom
  const getElementPixelSize = (
    el: HTMLElement,
    zoom: number = 1,
  ): {
    width: string;
    height: string;
    widthNum: number;
    heightNum: number;
  } => {
    const styleWidth = el.style.width;
    const styleHeight = el.style.height;
    const isPct = (v: string) => typeof v === 'string' && v.trim().endsWith('%');
    const rect = el.getBoundingClientRect();
    const rectW = rect.width / zoom;
    const rectH = rect.height / zoom;
    let wNum = NaN;
    let hNum = NaN;
    if (isPct(styleWidth) || !styleWidth) {
      wNum = rectW;
    } else {
      wNum = parseFloat(styleWidth);
      if (isNaN(wNum)) wNum = rectW;
    }
    if (isPct(styleHeight) || !styleHeight) {
      hNum = rectH;
    } else {
      hNum = parseFloat(styleHeight);
      if (isNaN(hNum)) hNum = rectH;
    }
    return {
      width: `${wNum}px`,
      height: `${hNum}px`,
      widthNum: wNum,
      heightNum: hNum,
    };
  };
  const isTextElement = (el: HTMLElement): boolean => {
    const tagName = el.tagName.toLowerCase();
    if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'strong', 'em', 'li'].includes(tagName)) {
      return true;
    }
    if (el.classList.contains('noppt-text-element')) {
      return true;
    }
    if (tagName === 'div' || tagName === 'section' || tagName === 'article') {
      const style = window.getComputedStyle(el);
      const hasBackground =
        style.backgroundImage !== 'none' ||
        (style.backgroundColor &&
          style.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
          style.backgroundColor !== 'transparent');
      const hasBorder =
        style.borderTopStyle !== 'none' ||
        style.borderBottomStyle !== 'none' ||
        style.borderLeftStyle !== 'none' ||
        style.borderRightStyle !== 'none';
      if (hasBackground || hasBorder) {
        return false;
      }
      const hasNonTextChild = Array.from(el.children).some((child) => {
        const childTag = child.tagName.toLowerCase();
        const nonTextTags = [
          'img',
          'svg',
          'video',
          'canvas',
          'audio',
          'iframe',
          'button',
          'input',
          'select',
          'textarea',
        ];
        if (nonTextTags.includes(childTag)) {
          return true;
        }
        if (
          (child as HTMLElement).classList?.contains('noppt-group-element') ||
          (child as HTMLElement).classList?.contains('noppt-slide-image-element')
        ) {
          return true;
        }
        return false;
      });
      if (hasNonTextChild) {
        return false;
      }
      const childCount = el.children.length;
      if (childCount === 0) {
        return !!el.textContent?.trim();
      }
      const textChildren = Array.from(el.children).filter((child) => {
        const childTag = child.tagName.toLowerCase();
        return (
          ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'strong', 'em', 'br'].includes(
            childTag,
          ) || (child as HTMLElement).classList?.contains('noppt-text-element')
        );
      });
      return textChildren.length === childCount;
    }
    return false;
  };
  useComputedStyleSync({
    selectedElements,
    isTextElement,
    getElementPixelSize,
    setIsMultiSelect,
    setElementType,
    setAllTextElements,
    setLocalStyles,
    setAspectRatio,
    setPosition,
    originalPositionRef,
    slideContainerRef,
  });
  const updaters = createPropertyUpdaters({
    selectedElements,
    setLocalStyles,
    setPosition,
    originalPositionRef,
    onChange,
    onMove,
    keepAspectRatio,
    isMultiSelect,
    aspectRatio,
    position,
    localStyles,
  });
  if (!isTextEditing && (!selectedElements || selectedElements.length === 0 || !elementType)) {
    return null;
  }
  const showHeaderTitle = () => {
    if (isTextEditing) {
      return (
        <div className="flex items-center gap-2">
          <Type className="w-4 h-4 text-blue-600" />
          <span className="font-medium text-slate-700 text-sm">{t('文本编辑')}</span>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2">
        {isMultiSelect && <Layers className="w-4 h-4 text-purple-600" />}
        {!isMultiSelect && elementType === 'text' && <Type className="w-4 h-4 text-blue-600" />}
        {!isMultiSelect && elementType === 'image' && <Image className="w-4 h-4 text-green-600" />}
        {!isMultiSelect && elementType === 'container' && (
          <div className="w-4 h-4 border-2 border-slate-400 rounded" />
        )}
        <span className="font-medium text-slate-700 text-sm">
          {isMultiSelect && t('{n} 个元素', { n: selectedElements.length })}
          {!isMultiSelect && elementType === 'text' && t('文字属性')}
          {!isMultiSelect && elementType === 'image' && t('图片属性')}
          {!isMultiSelect && elementType === 'container' && t('容器属性')}
        </span>
      </div>
    );
  };

  const shared: PropertyPanelSharedProps = {
    selectedElements,
    isTextEditing: isTextEditing ?? false,
    isMultiSelect,
    elementType,
    allTextElements,
    keepAspectRatio,
    position,
    localStyles,
    descriptorValues,
    mixedKeys,
    selectionStyles: selectionStyles ?? null,
    selectionListType,
    selectionListStyleType,
    bulletStyles,
    numberStyles,
    updaters,
    setDescriptorValue,
    setLocalStyles,
    onDelete,
    onAlign,
    onAlignSingle,
    onKeepAspectRatioChange,
    onCopy,
    onCancelPaste,
    onFormatBrush,
    onSplitText,
    onSelectionFontFamily,
    onSelectionFontSize,
    onSelectionBold,
    onSelectionItalic,
    onSelectionUnderline,
    onSelectionStrikethrough,
    onSelectionColor,
    onSelectionBackgroundColor,
    onSelectionAlign,
    onSelectionUnorderedList,
    onSelectionOrderedList,
    onSelectionListStyleType,
    onSelectionListWithStyle,
    onSelectionIconStyle,
    onBringToFront,
    onBringForward,
    onSendBackward,
    onSendToBack,
    isPasteMode,
    isFormatBrushMode,
  };

  return (
    <div data-property-panel="true" className="bg-white flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
        {showHeaderTitle()}
        <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded transition-colors">
          <X className="w-4 h-4 text-slate-500" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        <AlignSection {...shared} />
        <TextSection {...shared} />
        <StyleSection {...shared} />
        <LayoutSection {...shared} />
      </div>
    </div>
  );
}
