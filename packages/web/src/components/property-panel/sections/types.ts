import type { Dispatch, SetStateAction } from 'react';
import type { PropertyUpdaters } from '../updaters';
import type { IconStyle } from '@/utils/iconReplacer';

export type SelectionStyles = {
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

export type AlignType =
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'center-h'
  | 'center-v'
  | 'distribute-h'
  | 'distribute-v'
  | 'center-slide-h'
  | 'center-slide-v';

export type AlignSingleType =
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'center-h'
  | 'center-v'
  | 'center-slide-h'
  | 'center-slide-v';

export type ElementType = 'text' | 'image' | 'container' | 'mixed' | null;

// 所有区块组件共享的「值 + 回调」集合。
// PropertyPanel 主组件保留状态管理与编排，把渲染所需的全部动态值/设值器/回调
// 通过本类型显式下传，区块组件不做状态收敛，保证行为与原内联 JSX 完全一致。
export interface PropertyPanelSharedProps {
  selectedElements: HTMLElement[];
  isTextEditing: boolean;
  isMultiSelect: boolean;
  elementType: ElementType;
  allTextElements: boolean;
  keepAspectRatio?: boolean;
  position: { left: number; top: number };
  localStyles: Record<string, string>;
  descriptorValues: Record<string, string>;
  mixedKeys: Set<string>;
  selectionStyles: SelectionStyles;
  selectionListType?: 'ul' | 'ol' | null;
  selectionListStyleType?: string;
  bulletStyles?: Record<string, { symbol: string; label: string }>;
  numberStyles?: Record<string, { formatter: (i: number) => string; label: string }>;
  updaters: PropertyUpdaters;
  setDescriptorValue: (key: string, value: string) => void;
  setLocalStyles: Dispatch<SetStateAction<Record<string, string>>>;
  onDelete: () => void;
  onAlign?: (type: AlignType) => void;
  onAlignSingle?: (type: AlignSingleType) => void;
  onKeepAspectRatioChange?: (value: boolean) => void;
  onCopy?: () => void;
  onCancelPaste?: () => void;
  onFormatBrush?: () => void;
  onSplitText?: () => void;
  onSelectionFontFamily?: (font: string) => void;
  onSelectionFontSize?: (size: number) => void;
  onSelectionBold?: () => void;
  onSelectionItalic?: () => void;
  onSelectionUnderline?: () => void;
  onSelectionStrikethrough?: () => void;
  onSelectionColor?: (color: string) => void;
  onSelectionBackgroundColor?: (color: string) => void;
  onSelectionAlign?: (align: 'left' | 'center' | 'right' | 'justify') => void;
  onSelectionUnorderedList?: () => void;
  onSelectionOrderedList?: () => void;
  onSelectionListStyleType?: (styleType: string) => void;
  onSelectionListWithStyle?: (listType: 'ul' | 'ol', styleType: string) => void;
  onSelectionIconStyle?: (style: IconStyle) => void;
  onBringToFront?: () => void;
  onBringForward?: () => void;
  onSendBackward?: () => void;
  onSendToBack?: () => void;
  isPasteMode?: boolean;
  isFormatBrushMode?: boolean;
}
