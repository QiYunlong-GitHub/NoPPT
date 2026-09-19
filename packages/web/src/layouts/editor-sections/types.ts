import type { RefObject } from 'react';
import type { IconStyleOption } from '@/constants/iconStyles';
import type { IconStyle } from '@/utils/iconReplacer';
import type { ContextMenuState } from '@/hooks/useSelection';

export interface PresentationSummaryLike {
  id: string;
  title: string;
  slideCount: number;
  updatedAt: number;
}

export interface EditorToolbarProps {
  onBack: () => void;
  onOpenPresentation: () => void;
  hasUnsavedChanges: boolean;
  onSave: () => void;
  onExport: () => void;
  iconStyleMenuOpen: boolean;
  onToggleIconStyleMenu: (open: boolean) => void;
  iconStyleOptions: IconStyleOption[];
  onApplyIconStyle: (id: string) => void;
  onApplyIconStyleToCurrentSlide: (style: IconStyle) => void;
  onUndo: () => void;
  canUndo: boolean;
  onRedo: () => void;
  canRedo: boolean;
  onUnbind: () => void;
  selectedElements: Element[];
  onBind: () => void;
  onInsertTable: () => void;
  onInsertImage: () => void;
  onInsertVideo: () => void;
  onPreview: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomChange: (zoom: number) => void;
  zoom: number;
  iconStyleMenuRef: RefObject<HTMLDivElement>;
}

export interface ContextMenuProps {
  contextMenu: ContextMenuState | null;
  contextMenuRef: RefObject<HTMLDivElement>;
  iconStyleOptions: IconStyleOption[];
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onPasteAsImage: (x: number, y: number) => void;
  onPasteSlideAsImage: (x: number, y: number) => void;
  onPasteText: (x: number, y: number) => void;
  onPasteHtml: (x: number, y: number) => void;
  onPasteImage: (x: number, y: number) => void;
  onDeleteElement: () => void;
  onApplyIconStyleToCurrentSlide: (style: IconStyle) => void;
}

export interface PresentationListModalProps {
  open: boolean;
  presentations: PresentationSummaryLike[];
  currentId: string | undefined;
  onSelect: (id: string) => void;
  onClose: () => void;
}
