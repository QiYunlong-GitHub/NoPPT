import { t } from '@/i18n';
import { useState, useEffect, useRef } from 'react';
import {
  X,
  Trash2,
  Type,
  Image,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Minus,
  Plus,
  MoveUp,
  MoveDown,
  MoveLeft,
  MoveRight,
  AlignHorizontalJustifyCenter,
  AlignVerticalJustifyCenter,
  ArrowLeftRight,
  ArrowUpDown,
  Layers,
  Copy,
  Paintbrush,
  ArrowUpToLine,
  ArrowDownToLine,
  ArrowUp,
  ArrowDown,
  Scissors,
  List,
  ListOrdered,
  Hash,
  Check,
  Circle,
  Sparkles,
  Smile,
  PenTool,
  Square,
} from 'lucide-react';
import type { IconStyle } from '@/utils/iconReplacer';
import { propertyDescriptors, propertyDescriptorMap } from '@/constants/propertyDescriptors';
import type { PropertyDescriptor } from '@/constants/propertyDescriptors';
import { usePropertyValues } from '@/hooks/usePropertyValues';
import { parseNumberValue, formatNumberValue } from '@/utils/styleProperties';
const FONT_LIST = [
  { value: 'Microsoft YaHei, 微软雅黑, sans-serif', label: t('微软雅黑') },
  { value: 'SimSun, 宋体, serif', label: t('宋体') },
  { value: 'SimHei, 黑体, sans-serif', label: t('黑体') },
  { value: 'KaiTi, 楷体, serif', label: t('楷体') },
  { value: 'FangSong, 仿宋, serif', label: t('仿宋') },
  { value: 'NSimSun, 新宋体, serif', label: t('新宋体') },
  { value: 'Arial, sans-serif', label: 'Arial' },
  { value: '"Times New Roman", serif', label: 'Times New Roman' },
  { value: '"Courier New", monospace', label: 'Courier New' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: 'Verdana, sans-serif', label: 'Verdana' },
  { value: 'system-ui, sans-serif', label: t('系统默认') },
];
const matchFontFamily = (computedFont: string): string => {
  if (!computedFont) return '';
  const lowerFont = computedFont.toLowerCase().replace(/['"]/g, '');
  for (const font of FONT_LIST) {
    const firstFont = font.value.split(',')[0].trim().toLowerCase().replace(/['"]/g, '');
    if (lowerFont.includes(firstFont)) {
      return font.value;
    }
  }
  return computedFont;
};
function rgbToHex(rgb: string): string {
  if (rgb.startsWith('#')) return rgb;
  const match = rgb.match(/\d+/g);
  if (!match || match.length < 3) return '#000000';
  const r = parseInt(match[0]).toString(16).padStart(2, '0');
  const g = parseInt(match[1]).toString(16).padStart(2, '0');
  const b = parseInt(match[2]).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}
interface DescriptorNumberInputProps {
  descriptor: PropertyDescriptor;
  value: string;
  mixed?: boolean;
  onValueChange: (value: string) => void;
  onNumberChange?: (num: number) => void;
  onAdjust?: (delta: number) => void;
  showSteppers?: boolean;
  inputClassName?: string;
}
function DescriptorNumberInput({
  descriptor,
  value,
  mixed,
  onValueChange,
  onNumberChange,
  onAdjust,
  showSteppers,
  inputClassName,
}: DescriptorNumberInputProps) {
  const numVal = value ? parseNumberValue(value, descriptor.unit || 'px') : 0;
  const display = mixed ? '' : value ? String(numVal) : '';
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (isNaN(val)) return;
    const clamped = descriptor.min !== undefined && val < descriptor.min ? descriptor.min : val;
    const final =
      descriptor.max !== undefined && clamped > descriptor.max ? descriptor.max : clamped;
    if (onNumberChange) {
      onNumberChange(final);
    } else {
      onValueChange(formatNumberValue(final, descriptor.unit || 'px'));
    }
  };
  return (
    <div className="flex items-center gap-2">
      {showSteppers && (
        <button
          onClick={() => onAdjust?.(-(descriptor.step || 1))}
          className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <Minus className="w-4 h-4 text-slate-600" />
        </button>
      )}
      <input
        type="number"
        value={display}
        onChange={handleChange}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            (e.target as HTMLInputElement).blur();
          }
        }}
        min={descriptor.min}
        max={descriptor.max}
        step={descriptor.step}
        placeholder={mixed ? t('混合') : undefined}
        className={
          inputClassName ||
          'flex-1 text-center text-sm text-slate-700 font-medium px-2 py-1 border border-slate-200 rounded focus:outline-none focus:border-blue-500'
        }
      />
      {descriptor.unit && <span className="text-xs text-slate-400 w-6">{descriptor.unit}</span>}
      {showSteppers && (
        <button
          onClick={() => onAdjust?.(descriptor.step || 1)}
          className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4 text-slate-600" />
        </button>
      )}
    </div>
  );
}
interface DescriptorColorInputProps {
  descriptor: PropertyDescriptor;
  value: string;
  mixed?: boolean;
  onValueChange: (value: string) => void;
}
function DescriptorColorInput({
  descriptor,
  value,
  mixed,
  onValueChange,
}: DescriptorColorInputProps) {
  const hex = value ? rgbToHex(value) : rgbToHex(String(descriptor.defaultValue || '#000000'));
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={hex}
        onChange={(e) => onValueChange(e.target.value)}
        className="w-10 h-10 rounded-lg cursor-pointer border border-slate-200"
      />
      <span className="text-xs text-slate-500 font-mono">{mixed ? t('混合') : hex}</span>
    </div>
  );
}
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
  useEffect(() => {
    if (!selectedElements || selectedElements.length === 0) {
      setIsMultiSelect(false);
      setElementType(null);
      setAllTextElements(false);
      setLocalStyles({});
      return;
    }
    setIsMultiSelect(selectedElements.length > 1);
    const allText = selectedElements.every((el) => isTextElement(el));
    setAllTextElements(allText);
    if (selectedElements.length === 1) {
      const element = selectedElements[0];
      const tagName = element.tagName.toLowerCase();
      if (tagName === 'img' || tagName === 'video') {
        setElementType('image');
      } else if (isTextElement(element)) {
        setElementType('text');
      } else {
        setElementType('container');
      }
      const computedStyle = window.getComputedStyle(element);
      const slideContent = element.closest('[data-slide-content="true"]');
      const slideContainer = element.closest('[data-slide-zoom]');
      slideContainerRef.current = slideContainer;
      const zoom = slideContainer
        ? parseFloat(slideContainer.getAttribute('data-slide-zoom') || '1')
        : 1;
      const { width, height, widthNum, heightNum } = getElementPixelSize(element, zoom);
      setLocalStyles({
        fontSize: computedStyle.fontSize,
        fontWeight: computedStyle.fontWeight,
        fontStyle: computedStyle.fontStyle,
        textDecoration: computedStyle.textDecorationLine,
        color: computedStyle.color,
        backgroundColor: element.style.backgroundColor || computedStyle.backgroundColor,
        fontFamily: computedStyle.fontFamily,
        textAlign: element.style.textAlign || computedStyle.textAlign,
        width,
        height,
        borderRadius: element.style.borderRadius || computedStyle.borderRadius,
        boxShadow:
          element.style.boxShadow ||
          (computedStyle.boxShadow !== 'none' ? computedStyle.boxShadow : ''),
        backdropFilter:
          element.style.backdropFilter ||
          (computedStyle.backdropFilter !== 'none' ? computedStyle.backdropFilter : ''),
        border:
          element.style.border ||
          (computedStyle.borderStyle !== 'none'
            ? `${computedStyle.borderWidth} ${computedStyle.borderStyle} ${computedStyle.borderColor}`
            : ''),
      });
      if (widthNum > 0 && heightNum > 0) {
        setAspectRatio(widthNum / heightNum);
      }
      if (slideContainer && slideContent) {
        const containerRect = slideContent.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();
        const left = (elementRect.left - containerRect.left) / zoom;
        const top = (elementRect.top - containerRect.top) / zoom;
        setPosition({ left, top });
        originalPositionRef.current = { left, top };
      }
    } else {
      const types = new Set<string>();
      selectedElements.forEach((el) => {
        const tagName = el.tagName.toLowerCase();
        if (tagName === 'img' || tagName === 'video') {
          types.add('image');
        } else if (isTextElement(el)) {
          types.add('text');
        } else {
          types.add('container');
        }
      });
      setElementType(
        types.size > 1 ? 'mixed' : (types.values().next().value as 'text' | 'image' | 'container'),
      );
      const firstEl = selectedElements[0];
      const computedStyle = window.getComputedStyle(firstEl);
      const slideContent = firstEl.closest('[data-slide-content="true"]');
      const slideContainer = firstEl.closest('[data-slide-zoom]');
      slideContainerRef.current = slideContainer;
      const zoom = slideContainer
        ? parseFloat(slideContainer.getAttribute('data-slide-zoom') || '1')
        : 1;
      const { width, height } = getElementPixelSize(firstEl, zoom);
      if (allText) {
        setLocalStyles({
          fontSize: computedStyle.fontSize,
          fontWeight: computedStyle.fontWeight,
          fontStyle: computedStyle.fontStyle,
          textDecoration: computedStyle.textDecorationLine,
          color: computedStyle.color,
          backgroundColor: firstEl.style.backgroundColor || computedStyle.backgroundColor,
          fontFamily: computedStyle.fontFamily,
          textAlign: firstEl.style.textAlign || computedStyle.textAlign,
          width,
          height,
          borderRadius: firstEl.style.borderRadius || computedStyle.borderRadius,
          boxShadow:
            firstEl.style.boxShadow ||
            (computedStyle.boxShadow !== 'none' ? computedStyle.boxShadow : ''),
          backdropFilter:
            firstEl.style.backdropFilter ||
            (computedStyle.backdropFilter !== 'none' ? computedStyle.backdropFilter : ''),
          border:
            firstEl.style.border ||
            (computedStyle.borderStyle !== 'none'
              ? `${computedStyle.borderWidth} ${computedStyle.borderStyle} ${computedStyle.borderColor}`
              : ''),
        });
      } else {
        setLocalStyles({
          width,
          height,
          borderRadius: firstEl.style.borderRadius || computedStyle.borderRadius,
          boxShadow:
            firstEl.style.boxShadow ||
            (computedStyle.boxShadow !== 'none' ? computedStyle.boxShadow : ''),
          backdropFilter:
            firstEl.style.backdropFilter ||
            (computedStyle.backdropFilter !== 'none' ? computedStyle.backdropFilter : ''),
          border:
            firstEl.style.border ||
            (computedStyle.borderStyle !== 'none'
              ? `${computedStyle.borderWidth} ${computedStyle.borderStyle} ${computedStyle.borderColor}`
              : ''),
          backgroundColor: firstEl.style.backgroundColor || computedStyle.backgroundColor,
        });
      }
      if (slideContainer && slideContent) {
        const containerRect = slideContent.getBoundingClientRect();
        const elementRect = firstEl.getBoundingClientRect();
        const left = (elementRect.left - containerRect.left) / zoom;
        const top = (elementRect.top - containerRect.top) / zoom;
        setPosition({ left, top });
        originalPositionRef.current = { left, top };
      }
    }
  }, [selectedElements]);
  const updateStyle = (property: string, value: string) => {
    if (!selectedElements || selectedElements.length === 0) return;
    selectedElements.forEach((element) => {
      (element.style as any)[property] = value;
    });
    setLocalStyles((prev) => ({ ...prev, [property]: value }));
    onChange();
  };
  const adjustFontSize = (delta: number) => {
    if (!selectedElements || selectedElements.length === 0) return;
    selectedElements.forEach((element) => {
      const computedStyle = window.getComputedStyle(element);
      const currentSize = parseFloat(computedStyle.fontSize);
      const newSize = Math.max(8, Math.min(200, currentSize + delta));
      element.style.fontSize = `${newSize}px`;
    });
    const firstEl = selectedElements[0];
    const computedStyle = window.getComputedStyle(firstEl);
    const currentSize = parseFloat(computedStyle.fontSize);
    const newSize = Math.max(8, Math.min(200, currentSize + delta));
    setLocalStyles((prev) => ({ ...prev, fontSize: `${newSize}px` }));
    onChange();
  };
  const adjustFontSizeTo = (size: number) => {
    if (!selectedElements || selectedElements.length === 0) return;
    const newSize = Math.max(8, Math.min(200, size));
    selectedElements.forEach((element) => {
      element.style.fontSize = `${newSize}px`;
    });
    setLocalStyles((prev) => ({ ...prev, fontSize: `${newSize}px` }));
    onChange();
  };
  const adjustFontFamilyTo = (fontFamily: string) => {
    if (!selectedElements || selectedElements.length === 0) return;
    selectedElements.forEach((element) => {
      element.style.fontFamily = fontFamily;
    });
    setLocalStyles((prev) => ({ ...prev, fontFamily }));
    onChange();
  };
  const adjustPosition = (direction: 'up' | 'down' | 'left' | 'right', amount: number = 5) => {
    if (onMove) {
      onMove(direction, amount);
    }
  };
  const updateWidth = (value: number) => {
    if (!selectedElements || selectedElements.length === 0) return;
    const newWidth = value;
    selectedElements.forEach((element) => {
      const isGroup = element.getAttribute('data-element-type') === 'group';
      const contentWrapper = element.querySelector('.noppt-group-content') as HTMLElement | null;
      element.style.width = `${newWidth}px`;
      element.style.maxWidth = 'none';
      if (keepAspectRatio && !isMultiSelect) {
        const newHeight = newWidth / aspectRatio;
        element.style.height = `${newHeight}px`;
        element.style.maxHeight = 'none';
        if (isGroup && contentWrapper) {
          const initialScaleX = parseFloat(element.getAttribute('data-group-scale-x') || '1');
          const initialScaleY = parseFloat(element.getAttribute('data-group-scale-y') || '1');
          const startWidth = element.offsetWidth;
          const startHeight = element.offsetHeight;
          const ratioX = newWidth / startWidth;
          const ratioY = newHeight / startHeight;
          const newScaleX = initialScaleX * ratioX;
          const newScaleY = initialScaleY * ratioY;
          contentWrapper.style.transform = `scale(${newScaleX}, ${newScaleY})`;
          element.setAttribute('data-group-scale-x', String(newScaleX));
          element.setAttribute('data-group-scale-y', String(newScaleY));
        }
      } else if (isGroup && contentWrapper) {
        const initialScaleX = parseFloat(element.getAttribute('data-group-scale-x') || '1');
        const startWidth = element.offsetWidth;
        const ratioX = newWidth / startWidth;
        const newScaleX = initialScaleX * ratioX;
        contentWrapper.style.transform = `scale(${newScaleX}, ${parseFloat(element.getAttribute('data-group-scale-y') || '1')})`;
        element.setAttribute('data-group-scale-x', String(newScaleX));
      }
    });
    setLocalStyles((prev) => {
      const updated: Record<string, string> = { ...prev, width: `${newWidth}px` };
      if (keepAspectRatio && !isMultiSelect) {
        updated.height = `${newWidth / aspectRatio}px`;
      }
      return updated;
    });
    onChange();
  };
  const updateHeight = (value: number) => {
    if (!selectedElements || selectedElements.length === 0) return;
    const newHeight = value;
    selectedElements.forEach((element) => {
      const isGroup = element.getAttribute('data-element-type') === 'group';
      const contentWrapper = element.querySelector('.noppt-group-content') as HTMLElement | null;
      element.style.height = `${newHeight}px`;
      element.style.maxHeight = 'none';
      if (keepAspectRatio && !isMultiSelect) {
        const newWidth = newHeight * aspectRatio;
        element.style.width = `${newWidth}px`;
        element.style.maxWidth = 'none';
        if (isGroup && contentWrapper) {
          const initialScaleX = parseFloat(element.getAttribute('data-group-scale-x') || '1');
          const initialScaleY = parseFloat(element.getAttribute('data-group-scale-y') || '1');
          const startWidth = element.offsetWidth;
          const startHeight = element.offsetHeight;
          const ratioX = newWidth / startWidth;
          const ratioY = newHeight / startHeight;
          const newScaleX = initialScaleX * ratioX;
          const newScaleY = initialScaleY * ratioY;
          contentWrapper.style.transform = `scale(${newScaleX}, ${newScaleY})`;
          element.setAttribute('data-group-scale-x', String(newScaleX));
          element.setAttribute('data-group-scale-y', String(newScaleY));
        }
      } else if (isGroup && contentWrapper) {
        const initialScaleY = parseFloat(element.getAttribute('data-group-scale-y') || '1');
        const startHeight = element.offsetHeight;
        const ratioY = newHeight / startHeight;
        const newScaleY = initialScaleY * ratioY;
        contentWrapper.style.transform = `scale(${parseFloat(element.getAttribute('data-group-scale-x') || '1')}, ${newScaleY})`;
        element.setAttribute('data-group-scale-y', String(newScaleY));
      }
    });
    setLocalStyles((prev) => {
      const updated: Record<string, string> = { ...prev, height: `${newHeight}px` };
      if (keepAspectRatio && !isMultiSelect) {
        updated.width = `${newHeight * aspectRatio}px`;
      }
      return updated;
    });
    onChange();
  };
  const updatePositionX = (value: number) => {
    if (!selectedElements || selectedElements.length === 0) return;
    const deltaX = value - position.left;
    selectedElements.forEach((element) => {
      let currentTx = 0;
      let currentTy = 0;
      const transform = element.style.transform;
      if (transform && transform.includes('translate')) {
        const match = transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
        if (match) {
          currentTx = parseFloat(match[1]);
          currentTy = parseFloat(match[2]);
        }
      }
      element.style.transform = `translate(${currentTx + deltaX}px, ${currentTy}px)`;
    });
    setPosition((prev) => ({ ...prev, left: value }));
    originalPositionRef.current.left = value;
    onChange();
  };
  const updatePositionY = (value: number) => {
    if (!selectedElements || selectedElements.length === 0) return;
    const deltaY = value - position.top;
    selectedElements.forEach((element) => {
      let currentTx = 0;
      let currentTy = 0;
      const transform = element.style.transform;
      if (transform && transform.includes('translate')) {
        const match = transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
        if (match) {
          currentTx = parseFloat(match[1]);
          currentTy = parseFloat(match[2]);
        }
      }
      element.style.transform = `translate(${currentTx}px, ${currentTy + deltaY}px)`;
    });
    setPosition((prev) => ({ ...prev, top: value }));
    originalPositionRef.current.top = value;
    onChange();
  };
  const handlePositionXBlur = () => {
    if (position.left < 0) {
      updatePositionX(0);
    }
  };
  const handlePositionYBlur = () => {
    if (position.top < 0) {
      updatePositionY(0);
    }
  };
  const handleWidthBlur = () => {
    const w = parseFloat(localStyles.width || '0');
    if (w < 10) {
      updateWidth(10);
    }
  };
  const handleHeightBlur = () => {
    const h = parseFloat(localStyles.height || '0');
    if (h < 10) {
      updateHeight(10);
    }
  };
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
  return (
    <div data-property-panel="true" className="bg-white flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
        {showHeaderTitle()}
        <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded transition-colors">
          <X className="w-4 h-4 text-slate-500" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {isMultiSelect && onAlign && (
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
        )}

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
                  onChange={(e) => onSelectionColor?.(e.target.value)}
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
                  onChange={(e) => onSelectionBackgroundColor?.(e.target.value)}
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
                onChange={(e) => adjustFontFamilyTo(e.target.value)}
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
                  adjustFontSizeTo(num);
                }}
                onNumberChange={(num) => adjustFontSizeTo(num)}
                onAdjust={(delta) => adjustFontSize(delta)}
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

        {!isMultiSelect && elementType === 'image' && (
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
                      updateWidth(val);
                    }
                  }}
                  onBlur={handleWidthBlur}
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
                      updateHeight(val);
                    }
                  }}
                  onBlur={handleHeightBlur}
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

        {/* ===== L1.5 容器视觉样式：玻璃/圆角/阴影/边框 ===== */}
        {!isTextEditing && selectedElements.length > 0 && !allTextElements && (
          <div className="pt-3 border-t border-slate-200">
            <label className="block text-xs font-medium text-slate-600 mb-2">
              {t('视觉样式（L1.5）')}
            </label>
            <div className="space-y-3">
              {/* 背景颜色 */}
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

              {/* 圆角 */}
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

              {/* 边框粗细 */}
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
                    // 提取当前 border 中的颜色和样式
                    const colorMatch = (cur || '').match(
                      /#[0-9a-f]{6}|rgba?\([^)]*\)|rgb\([^)]*\)/i,
                    );
                    const color = colorMatch ? colorMatch[0] : '#e2e8f0';
                    const styleMatch = (cur || '').match(/\b(solid|dashed|dotted|double)\b/i);
                    const style = styleMatch ? styleMatch[0] : 'solid';
                    updateStyle('border', `${val}px ${style} ${color}`);
                  }}
                  className="flex-1 px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <span className="text-xs text-slate-400 w-6">px</span>
              </div>

              {/* 阴影预设 */}
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
                      if (val === 'none') updateStyle('boxShadow', '');
                      else if (val === 'sm') updateStyle('boxShadow', '0 1px 4px rgba(0,0,0,0.08)');
                      else if (val === 'md') updateStyle('boxShadow', '0 4px 12px rgba(0,0,0,0.1)');
                      else if (val === 'lg')
                        updateStyle('boxShadow', '0 8px 32px rgba(0,0,0,0.12)');
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

              {/* 玻璃拟态 blur 强度 */}
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
                            localStyles.backdropFilter.match(/blur\((\d+(?:\.\d+)?)px\)/)?.[1] ||
                              '0',
                          )
                        : 0
                    }
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      const px = isNaN(v) ? 0 : Math.max(0, v);
                      if (px === 0) {
                        updateStyle('backdropFilter', '');
                        // 同步清除 -webkit- 前缀
                        selectedElements.forEach((el) => {
                          (el.style as any).webkitBackdropFilter = '';
                        });
                      } else {
                        const blurVal = `blur(${px}px)`;
                        updateStyle('backdropFilter', blurVal);
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

        {!isTextEditing && selectedElements.length > 0 && (
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2">{t('位置')}</label>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 w-8">X</span>
                <input
                  type="number"
                  value={Math.round(position.left)}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val)) {
                      updatePositionX(val);
                    }
                  }}
                  onBlur={handlePositionXBlur}
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
                <span className="text-xs text-slate-500 w-8">Y</span>
                <input
                  type="number"
                  value={Math.round(position.top)}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val)) {
                      updatePositionY(val);
                    }
                  }}
                  onBlur={handlePositionYBlur}
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

        {!isTextEditing && selectedElements.length > 0 && (
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2">{t('页面居中')}</label>
            <div className="grid grid-cols-2 gap-1">
              <button
                onClick={() =>
                  isMultiSelect ? onAlign?.('center-slide-h') : onAlignSingle?.('center-slide-h')
                }
                className="p-2 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                title={t('页面水平居中')}
              >
                <AlignHorizontalJustifyCenter className="w-4 h-4 text-blue-600 mx-auto" />
                <span className="text-xs text-blue-600 font-medium block mt-1">
                  {t('水平居中')}
                </span>
              </button>
              <button
                onClick={() =>
                  isMultiSelect ? onAlign?.('center-slide-v') : onAlignSingle?.('center-slide-v')
                }
                className="p-2 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                title={t('页面垂直居中')}
              >
                <AlignVerticalJustifyCenter className="w-4 h-4 text-blue-600 mx-auto" />
                <span className="text-xs text-blue-600 font-medium block mt-1">
                  {t('垂直居中')}
                </span>
              </button>
            </div>
          </div>
        )}

        {!isTextEditing && selectedElements.length > 0 && (
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2">
              {t('位置微调')}
              {isMultiSelect && (
                <span className="text-slate-400 font-normal ml-1">{t('（批量移动）')}</span>
              )}
            </label>
            <div className="grid grid-cols-3 gap-1">
              <div></div>
              <button
                onClick={() => adjustPosition('up', 5)}
                className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                <MoveUp className="w-4 h-4 text-slate-600 mx-auto" />
              </button>
              <div></div>
              <button
                onClick={() => adjustPosition('left', 5)}
                className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                <MoveLeft className="w-4 h-4 text-slate-600 mx-auto" />
              </button>
              <div className="p-2 bg-slate-50 rounded-lg flex items-center justify-center">
                <span className="text-xs text-slate-400">{t('移动')}</span>
              </div>
              <button
                onClick={() => adjustPosition('right', 5)}
                className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                <MoveRight className="w-4 h-4 text-slate-600 mx-auto" />
              </button>
              <div></div>
              <button
                onClick={() => adjustPosition('down', 5)}
                className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                <MoveDown className="w-4 h-4 text-slate-600 mx-auto" />
              </button>
              <div></div>
            </div>
          </div>
        )}

        {!isTextEditing && onCopy && selectedElements.length > 0 && (
          <div className="pt-4 border-t border-slate-200">
            <label className="block text-xs font-medium text-slate-600 mb-2">{t('图层调整')}</label>
            <div className="grid grid-cols-4 gap-1 mb-3">
              <button
                onClick={onBringToFront}
                className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                title={t('置于顶层')}
              >
                <ArrowUpToLine className="w-4 h-4 text-slate-600 mx-auto" />
              </button>
              <button
                onClick={onBringForward}
                className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                title={t('上移一层')}
              >
                <ArrowUp className="w-4 h-4 text-slate-600 mx-auto" />
              </button>
              <button
                onClick={onSendBackward}
                className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                title={t('下移一层')}
              >
                <ArrowDown className="w-4 h-4 text-slate-600 mx-auto" />
              </button>
              <button
                onClick={onSendToBack}
                className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                title={t('置于底层')}
              >
                <ArrowDownToLine className="w-4 h-4 text-slate-600 mx-auto" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {isPasteMode ? (
                <button
                  onClick={onCancelPaste}
                  className="flex items-center justify-center gap-2 py-2.5 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-lg transition-colors text-sm font-medium col-span-2"
                >
                  <X className="w-4 h-4" />
                  {t('取消粘贴')}
                </button>
              ) : (
                <>
                  <button
                    onClick={onCopy}
                    className="flex items-center justify-center gap-2 py-2.5 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg transition-colors text-sm font-medium"
                  >
                    <Copy className="w-4 h-4" />
                    {t('复制')}
                  </button>
                  {(elementType === 'text' || allTextElements) && onFormatBrush && (
                    <button
                      onClick={onFormatBrush}
                      className={`flex items-center justify-center gap-2 py-2.5 rounded-lg transition-colors text-sm font-medium ${
                        isFormatBrushMode
                          ? 'bg-purple-600 text-white'
                          : 'bg-purple-50 text-purple-600 hover:bg-purple-100'
                      }`}
                    >
                      <Paintbrush className="w-4 h-4" />
                      {t('格式刷')}
                    </button>
                  )}
                </>
              )}
            </div>
            {isPasteMode && (
              <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-700 text-center">
                {t('点击幻灯片上的位置进行粘贴，按 ESC 取消')}
              </div>
            )}
            {isFormatBrushMode && (
              <div className="mt-3 p-3 bg-purple-50 border border-purple-200 rounded-lg text-xs text-purple-700 text-center">
                {t('点击目标文字元素应用格式')}
              </div>
            )}
          </div>
        )}

        {!isTextEditing && selectedElements.length > 0 && (
          <div className="pt-4 border-t border-slate-200">
            <button
              onClick={onDelete}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg transition-colors text-sm font-medium"
            >
              <Trash2 className="w-4 h-4" />
              {isMultiSelect ? t('删除选中元素') : t('删除元素')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
