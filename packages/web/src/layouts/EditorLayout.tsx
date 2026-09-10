import { useEffect, useState, useRef } from 'react';
import {
  Play,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Save,
  ArrowLeft,
  Download,
  Table,
  Table2,
  Type,
  Image as ImageIcon,
  Video,
  Settings,
  Sparkles,
  FolderOpen,
  X,
  Copy,
  Trash2,
  ClipboardPaste,
  Scissors,
  Group as GroupIcon,
  Ungroup as UngroupIcon,
  Hash,
  Check,
  Minus,
  Circle,
} from 'lucide-react';
import { usePresentationStore } from '@/stores/presentation';
import { useUIStore } from '@/stores/ui';
import { useNavigate } from 'react-router-dom';
import SlideListPanel from '@/components/SlideListPanel';
import AIChatPanel from '@/components/AIChatPanel';
import PropertyPanel from '@/components/PropertyPanel';
import { SelectionOverlay } from '@/components/SelectionOverlay';
import { GuidesOverlay } from '@/components/GuidesOverlay';
import SelectionBreadcrumb from '@/components/SelectionBreadcrumb';
import { assetsApi } from '@/utils/api';
import { sanitizeHtml } from '@/utils';
import { useI18n } from '@/i18n';
import {
  replaceIconsInElements,
  replaceIconsInElement,
  addIconsToElements,
  findAndAddIconsInSlide,
  findBestIconContainer,
  type IconStyle,
} from '@/utils/iconReplacer';
import html2canvas from 'html2canvas';
import { BULLET_STYLES, NUMBER_STYLES } from '@/constants/listStyles';
import { ICON_STYLE_OPTIONS } from '@/constants/iconStyles';
import type { IconStyleOption } from '@/constants/iconStyles';
import { useZoom } from '@/hooks/useZoom';
import { useSelection, type ClipboardElement, type ContextMenuState } from '@/hooks/useSelection';
import { useContextMenu } from '@/hooks/useContextMenu';
import { useElementOperations } from '@/hooks/useElementOperations';
import { useTextEditing } from '@/hooks/useTextEditing';
import { useClipboard } from '@/hooks/useClipboard';
import {
  getElementByPath as _getElementByPath,
  wrapTextInVisualContainers as _wrapTextInVisualContainers,
  isLayoutContainer as _isLayoutContainer,
  isVisualContainer as _isVisualContainer,
  isTextContent as _isTextContent,
  isTextElement as _isTextElement,
  findSelectableElement as _findSelectableElement,
  getSlideAppendTarget as _getSlideAppendTarget,
  normalizeWhitespaceTextNodes as _normalizeWhitespaceTextNodes,
  ensureElementIds as _ensureElementIds,
} from '@/utils/selection';
import {
  createTextElement as _createTextElement,
  createImageElement as _createImageElement,
  createTableElement as _createTableElement,
} from '@/utils/elementFactories';
import { getLinePrefixInfo as _getLinePrefixInfo } from '@/utils/listFormatting';
import { toggleListInRange as _toggleListInRange } from '@/utils/listDom';

interface EditorLayoutProps {
  children?: React.ReactNode;
}

export default function EditorLayout({}: EditorLayoutProps) {
  const navigate = useNavigate();

  const presentation = usePresentationStore((s) => s.presentation);
  const selectedSlideId = usePresentationStore((s) => s.presentation?.selectedSlideId);
  const undo = usePresentationStore((s) => s.undo);
  const redo = usePresentationStore((s) => s.redo);
  const canUndo = usePresentationStore((s) => s.canUndo);
  const canRedo = usePresentationStore((s) => s.canRedo);
  const zoom = usePresentationStore((s) => s.presentation?.zoom ?? 1);
  const setZoom = usePresentationStore((s) => s.setZoom);
  const savePresentation = usePresentationStore((s) => s.savePresentation);
  const updatePresentation = usePresentationStore((s) => s.updatePresentation);
  const updateSlide = usePresentationStore((s) => s.updateSlide);
  const loadAllPresentations = usePresentationStore((s) => s.loadAllPresentations);
  const closeCurrentPresentation = usePresentationStore((s) => s.closeCurrentPresentation);
  const presentations = usePresentationStore((s) => s.presentations);
  const hasUnsavedChanges = usePresentationStore((s) => s.hasUnsavedChanges);
  const markUnsavedStore = usePresentationStore((s) => s.markUnsaved);
  const applyIconStyle = usePresentationStore((s) => s.applyIconStyle);
  const saveHistory = usePresentationStore((s) => s.saveHistory);
  const setExportModal = useUIStore((s) => s.setExportModal);
  const showToast = useUIStore((s) => s.showToast);
  const { t } = useI18n();

  const slideContainerRef = useRef<HTMLDivElement>(null);
  const editorAreaRef = useRef<HTMLDivElement>(null);
  const { userZoomOverrideRef } = useZoom({
    editorAreaRef,
    presentationId: presentation?.id,
    presentationWidth: presentation?.width,
    presentationHeight: presentation?.height,
    setZoom,
  });
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const [showPropertyPanel, setShowPropertyPanel] = useState(false);
  const [rightPanelTab, setRightPanelTab] = useState<'property' | 'ai'>('ai');
  const hasUnsavedChangesRef = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const lastSavedHtmlRef = useRef<string>('');
  const prevSlideIdRef = useRef<string | undefined>(undefined);
  const [clipboardElements, setClipboardElements] = useState<ClipboardElement[]>([]);
  const [isPasteMode, setIsPasteMode] = useState(false);
  const [clipboardSourceSlideId, setClipboardSourceSlideId] = useState<string | null>(null);
  const tabIdRef = useRef<string>(Math.random().toString(36).substring(2, 10));
  const [formatBrushData, setFormatBrushData] = useState<Record<string, string> | null>(null);
  const [isFormatBrushMode, setIsFormatBrushMode] = useState(false);
  const [keepAspectRatio, setKeepAspectRatio] = useState(false);
  const propertyPanelRef = useRef<HTMLDivElement>(null);
  const [iconStyleMenuOpen, setIconStyleMenuOpen] = useState(false);
  const iconStyleMenuRef = useRef<HTMLDivElement>(null);
  const [showTableDialog, setShowTableDialog] = useState(false);
  const [tableRows, setTableRows] = useState(3);
  const [tableCols, setTableCols] = useState(3);
  const [showPresentationList, setShowPresentationList] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const keepAspectRatioRef = useRef(keepAspectRatio);
  keepAspectRatioRef.current = keepAspectRatio;
  const keyHeldRef = useRef({ i: false, o: false });

  const stopTextEditingRef = useRef<() => void>(() => {});
  const handlePasteAtPositionRef = useRef<(clientX: number, clientY: number) => void>(() => {});
  const handleFormatBrushApplyRef = useRef<(element: HTMLElement) => void>(() => {});
  const clearClipboardRef = useRef<() => void>(() => {});
  const saveSlideHtmlRef = useRef<(addToHistory?: boolean, slideId?: string) => void>(() => {});

  const markUnsaved = () => {
    hasUnsavedChangesRef.current = true;
    markUnsavedStore();
  };

  useEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges;
  }, [hasUnsavedChanges]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
        return;
      if (e.key === 'i' || e.key === 'I') keyHeldRef.current.i = true;
      if (e.key === 'o' || e.key === 'O') keyHeldRef.current.o = true;
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'i' || e.key === 'I') keyHeldRef.current.i = false;
      if (e.key === 'o' || e.key === 'O') keyHeldRef.current.o = false;
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChangesRef.current) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  const handleOpenPresentation = async () => {
    try {
      await loadAllPresentations();
      setShowPresentationList(true);
    } catch (e) {
      showToast(t('加载演示列表失败'), 'error');
    }
  };

  const handleSelectPresentation = (id: string) => {
    if (id === presentation?.id) {
      setShowPresentationList(false);
      return;
    }
    const url = `/editor/${id}`;
    window.open(url, '_blank');
    setShowPresentationList(false);
  };

  const handleSave = async () => {
    if (hasUnsavedChangesRef.current) {
      saveSlideHtml();
    }
    const ok = await savePresentation();
    if (ok) {
      // 保存真正成功才同步 ref 和显示成功提示
      hasUnsavedChangesRef.current = false;
      showToast(t('保存成功'), 'success');
    } else {
      // API 未成功（Vite EPIPE/EACCES、后端异常等）：
      // 保持 hasUnsavedChangesRef/store 状态不变，按钮仍然是可点
      showToast(t('保存失败，请重试'), 'error');
    }
  };

  const handlePreview = () => {
    if (!presentation) return;
    if (hasUnsavedChangesRef.current) {
      saveSlideHtml();
    }
    savePresentation();
    navigate(`/preview/${presentation.id}`);
  };

  const handleBack = () => {
    if (hasUnsavedChangesRef.current) {
      if (confirm(t('您有未保存的更改，确定要离开吗？'))) {
        closeCurrentPresentation();
        navigate('/');
      }
    } else {
      closeCurrentPresentation();
      navigate('/');
    }
  };

  const currentSlide = presentation?.slides.find((s) => s.id === selectedSlideId);

  const wrapTextInVisualContainers = () => {
    const innerDiv = slideContainerRef.current?.querySelector(
      '[data-slide-content="true"]',
    ) as HTMLElement | null;
    _wrapTextInVisualContainers(innerDiv);
  };

  const normalizeWhitespaceTextNodes = () => {
    const innerDiv = slideContainerRef.current?.querySelector(
      '[data-slide-content="true"]',
    ) as HTMLElement | null;
    _normalizeWhitespaceTextNodes(innerDiv);
  };

  const ensureElementIds = () => {
    const innerDiv = slideContainerRef.current?.querySelector(
      '[data-slide-content="true"]',
    ) as HTMLElement | null;
    _ensureElementIds(innerDiv);
  };

  const isTextElement = (element: HTMLElement): boolean => _isTextElement(element);
  const getSlideAppendTarget = (innerDiv: HTMLElement): HTMLElement =>
    _getSlideAppendTarget(innerDiv);
  const findSelectableElement = (
    target: HTMLElement,
    mode: 'inner' | 'outer' | 'deep' | 'parent' = 'inner',
  ): HTMLElement | null => {
    const __innerDivForSel = slideContainerRef.current?.querySelector(
      '[data-slide-content="true"]',
    ) as HTMLElement | null;
    return _findSelectableElement(target, __innerDivForSel, mode);
  };

  const saveAndRestoreSelectionRef = useRef<() => void>(() => {});
  const highlightElementRef = useRef<(el: HTMLElement, highlight: boolean) => void>(() => {});
  const updateSelectedElementsRef = useRef<(elements: HTMLElement[]) => HTMLElement[]>(() => []);

  const {
    isTextEditing,
    setIsTextEditing,
    editingElementRef,
    savedSelectionRangeRef,
    selectionStyles,
    setSelectionStyles,
    selectionListType,
    setSelectionListType,
    selectionListStyleType,
    setSelectionListStyleType,
    fakeSelectionOverlayRef,
    startTableCellEditing,
    startTextEditing,
    stopTextEditing,
    splitTextElement,
    updateSelectionStyles,
    updateStylesFromRange,
    showFakeSelection,
    hideFakeSelection,
    resolveListRange,
    applyListToSelection,
    handleSelectionUnorderedList,
    handleSelectionOrderedList,
    applyListWithStyle,
    handleSelectionListStyleType,
    restoreSavedSelection,
    applyFormatToSelection,
    applyFontSizeToSelection,
    applyFontFamilyToSelection,
    applyColorToSelection,
    applyBoldToSelection,
    applyItalicToSelection,
    applyUnderlineToSelection,
    applyStrikethroughToSelection,
    applyBackgroundColorToSelection,
    applyAlignToSelection,
  } = useTextEditing({
    slideContainerRef,
    presentation,
    setRightPanelTab,
    setShowPropertyPanel,
    markUnsaved,
    saveSlideHtmlRef,
    highlightElementRef,
    updateSelectedElementsRef,
  });
  stopTextEditingRef.current = stopTextEditing;

  const {
    selectedElements,
    setSelectedElements,
    selectedElementsRef,
    selectedElementPathsRef,
    isRestoringSelectionRef,
    isSelectingRef,
    selectionBox,
    selectionStartRef,
    resizeBox,
    setResizeBox,
    updateResizeBox,
    guides,
    saveAndRestoreSelectionForNewElements,
    saveAndRestoreSelection,
    cleanSelectedElements,
    updateSelectedElements,
    highlightElement,
    commitAllSelectedTransforms,
    getElementPath,
    getElementByPath,
    isSlideRootWrapper,
    isTextContent,
    isVisualContainer,
    isLayoutContainer,
    handleSlidePointerDown,
    handleSlidePointerMove,
    handleSlidePointerUp,
    toggleElementSelection,
    addToSelection,
    clearSelection,
  } = useSelection({
    slideContainerRef,
    contentRef,
    presentationZoom: presentation?.zoom ?? 1,
    isTextEditing,
    editingElementRef,
    isPasteMode,
    clipboardElements,
    isFormatBrushMode,
    formatBrushData,
    keyHeldRef,
    keepAspectRatioRef,
    hasUnsavedChangesRef,
    contextMenu,
    setContextMenu,
    setShowPropertyPanel,
    setRightPanelTab,
    setIsFormatBrushMode,
    setFormatBrushData,
    stopTextEditingRef,
    handlePasteAtPositionRef,
    handleFormatBrushApplyRef,
    findSelectableElement,
    isTextElement,
    normalizeWhitespaceTextNodes,
    ensureElementIds,
    saveSlideHtmlRef,
    markUnsaved,
    clearClipboardRef,
  });

  saveAndRestoreSelectionRef.current = saveAndRestoreSelection;
  highlightElementRef.current = highlightElement;
  updateSelectedElementsRef.current = updateSelectedElements;

  const {
    checkClipboard,
    clearClipboard,
    readElementsFromClipboard,
    stripPastedIds,
    pasteElementsFromData,
    handleCopyElements,
    handleCopySlideAsImage,
    handlePasteAtPosition,
    handlePasteWithOffset,
    handlePasteFromClipboard,
    handlePasteFromClipboardRef: clipboardPasteFromClipboardRef,
    handlePasteEvent,
    handleCancelPaste,
    handlePasteSlideAsImage,
    handlePasteAsImage,
    handlePasteText,
    handlePasteHtml,
    handlePasteImage,
    handlePasteAtPositionRef: clipboardPasteAtPositionRef,
    handleCopyElementsRef: clipboardCopyElementsRef,
    handlePasteSlideAsImageRef: clipboardPasteSlideAsImageRef,
    handlePasteTextRef: clipboardPasteTextRef,
    handlePasteHtmlRef: clipboardPasteHtmlRef,
    handlePasteImageRef: clipboardPasteImageRef,
    readElementsFromClipboardRef: clipboardReadElementsRef,
    clearClipboardRef: clipboardClearRef,
    handleCancelPasteRef: clipboardCancelPasteRef,
    handlePasteEventRef: clipboardPasteEventRef,
  } = useClipboard({
    currentSlide,
    presentation,
    selectedSlideId: selectedSlideId ?? null,
    slideContainerRef,
    selectedElementsRef,
    clipboardElements,
    setClipboardElements,
    isPasteMode,
    setIsPasteMode,
    clipboardSourceSlideId,
    setClipboardSourceSlideId,
    tabIdRef,
    setContextMenu,
    setShowPropertyPanel,
    setRightPanelTab,
    setIsFormatBrushMode,
    setFormatBrushData,
    showToast,
    saveSlideHtmlRef,
    updateSelectedElements,
    highlightElement,
    saveAndRestoreSelectionForNewElements,
  });

  const handlePasteFromClipboardRef = clipboardPasteFromClipboardRef;
  handlePasteAtPositionRef.current = handlePasteAtPosition;
  clearClipboardRef.current = clearClipboard;
  const handleCopyElementsRef = clipboardCopyElementsRef;
  const handlePasteSlideAsImageRef = clipboardPasteSlideAsImageRef;
  const handlePasteTextRef = clipboardPasteTextRef;
  const handlePasteHtmlRef = clipboardPasteHtmlRef;
  const handlePasteImageRef = clipboardPasteImageRef;
  const readElementsFromClipboardRef = clipboardReadElementsRef;
  const handleCancelPasteRef = clipboardCancelPasteRef;
  const handlePasteEventRef = clipboardPasteEventRef;

  useEffect(() => {
    if (prevSlideIdRef.current !== undefined && prevSlideIdRef.current !== selectedSlideId) {
      if (hasUnsavedChangesRef.current) {
        saveSlideHtml(false, prevSlideIdRef.current);
      }
      lastSavedHtmlRef.current = '';
      setSelectedElements([]);
      setShowPropertyPanel(false);
    }
    prevSlideIdRef.current = selectedSlideId;
  }, [selectedSlideId]);

  useEffect(() => {
    if (!contentRef.current || !currentSlide) return;

    if (currentSlide.html === lastSavedHtmlRef.current) {
      return;
    }

    contentRef.current.innerHTML = sanitizeHtml(currentSlide.html || '');
    lastSavedHtmlRef.current = currentSlide.html || '';

    const rafId = requestAnimationFrame(() => {
      if (!contentRef.current) return;
      wrapTextInVisualContainers();
      normalizeWhitespaceTextNodes();
      ensureElementIds();
      if (selectedElementPathsRef.current.length > 0) {
        isRestoringSelectionRef.current = true;
        const restored: HTMLElement[] = [];
        selectedElementPathsRef.current.forEach((path) => {
          const el = _getElementByPath(path, contentRef.current);
          if (el) restored.push(el);
        });
        const finalRestored = updateSelectedElements(restored);
        finalRestored.forEach((el) => highlightElement(el, true));
        setShowPropertyPanel(finalRestored.length > 0);
        isRestoringSelectionRef.current = false;
      }
    });

    return () => cancelAnimationFrame(rafId);
  }, [currentSlide?.id, currentSlide?.html]);

  const handlePropertyChange = () => {
    markUnsaved();
    saveAndRestoreSelection();
  };

  const handleDeleteElement = () => {
    if (selectedElementsRef.current.length === 0 || !currentSlide) return;

    selectedElementsRef.current.forEach((el) => el.remove());
    saveSlideHtml(true);
    updateSelectedElements([]);
    setShowPropertyPanel(false);
  };

  const {
    handleContextMenu,
    handleDeleteElementFromMenu,
    handleCopyFromMenu,
    handleCutFromMenu,
    handlePasteFromMenu,
    handleCopySlideImageFromMenu,
  } = useContextMenu({
    isTextEditing,
    clipboardElements,
    contextMenu,
    setContextMenu,
    selectedElementsRef,
    findSelectableElement,
    clearSelection,
    addToSelection,
    checkClipboard,
    handleDeleteElement,
    handleCopyElements,
    handleCopySlideAsImage,
    handlePasteAtPosition,
    readElementsFromClipboard,
    pasteElementsFromData,
    saveAndRestoreSelectionForNewElements,
    slideContainerRef,
    presentationZoom: presentation?.zoom ?? 1,
    showToast,
  });

  const createTableElement = (
    x: number,
    y: number,
    rows: number = 3,
    cols: number = 3,
  ): HTMLElement => _createTableElement(x, y, rows, cols);

  const handleDeleteElementRef = useRef(handleDeleteElement);
  handleDeleteElementRef.current = handleDeleteElement;

  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;

  const handleInsertTable = () => {
    if (!currentSlide) return;

    const container = slideContainerRef.current;
    const innerDiv = container?.querySelector('[data-slide-content="true"]') as HTMLElement | null;
    if (!container || !innerDiv) return;

    const rect = innerDiv.getBoundingClientRect();
    const zoom = presentation?.zoom ?? 1;
    const centerX = rect.width / 2 / zoom - 200;
    const centerY = rect.height / 3 / zoom - 50;

    const tableEl = createTableElement(centerX, centerY, tableRows, tableCols);
    getSlideAppendTarget(innerDiv).appendChild(tableEl);

    saveSlideHtml(true);
    highlightElement(tableEl, true);
    updateSelectedElements([tableEl]);
    setShowPropertyPanel(true);
    setRightPanelTab('property');
    setShowTableDialog(false);
    markUnsaved();
  };

  const handleInsertImage = () => {
    imageInputRef.current?.click();
  };

  const handleImageFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentSlide || !presentation) return;

    try {
      showToast(t('正在上传图片...'), 'info');

      const asset = await assetsApi.upload(presentation.id, 'image', file);

      const container = slideContainerRef.current;
      const innerDiv = container?.querySelector(
        '[data-slide-content="true"]',
      ) as HTMLElement | null;
      if (!container || !innerDiv) return;

      const rect = innerDiv.getBoundingClientRect();
      const zoom = presentation?.zoom ?? 1;
      const centerX = rect.width / 2 / zoom - 150;
      const centerY = rect.height / 3 / zoom - 100;

      const imgEl = document.createElement('img');
      imgEl.src = asset.url;
      imgEl.style.cssText = `
        position: absolute;
        left: ${centerX}px;
        top: ${centerY}px;
        object-fit: contain;
      `;
      getSlideAppendTarget(innerDiv).appendChild(imgEl);

      imgEl.onload = () => {
        let width = imgEl.naturalWidth;
        let height = imgEl.naturalHeight;
        const maxWidth = 400;
        const maxHeight = 300;

        if (width > maxWidth) {
          height = (maxWidth / width) * height;
          width = maxWidth;
        }
        if (height > maxHeight) {
          width = (maxHeight / height) * width;
          height = maxHeight;
        }
        imgEl.style.width = `${width}px`;
        imgEl.style.height = `${height}px`;

        saveSlideHtml(true);
        updateResizeBox();
      };

      highlightElement(imgEl, true);
      updateSelectedElements([imgEl]);
      setShowPropertyPanel(true);
      setRightPanelTab('property');
      markUnsaved();
      showToast(t('图片插入成功'), 'success');
    } catch (err) {
      console.error('Failed to upload image:', err);
      showToast(t('图片上传失败，请重试'), 'error');
    }

    e.target.value = '';
  };

  const handleInsertVideo = () => {
    videoInputRef.current?.click();
  };

  const handleVideoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentSlide || !presentation) return;

    try {
      showToast(t('正在上传视频...'), 'info');

      const asset = await assetsApi.upload(presentation.id, 'video', file);

      const container = slideContainerRef.current;
      const innerDiv = container?.querySelector(
        '[data-slide-content="true"]',
      ) as HTMLElement | null;
      if (!container || !innerDiv) return;

      const rect = innerDiv.getBoundingClientRect();
      const zoom = presentation?.zoom ?? 1;
      const centerX = rect.width / 2 / zoom - 200;
      const centerY = rect.height / 3 / zoom - 100;

      const video = document.createElement('video');
      video.src = asset.url;
      video.controls = true;
      video.style.cssText = `
        position: absolute;
        left: ${centerX}px;
        top: ${centerY}px;
        object-fit: contain;
        background: #000;
      `;
      video.setAttribute('data-noppt-video', 'true');

      video.onloadedmetadata = () => {
        let width = video.videoWidth;
        let height = video.videoHeight;
        const maxWidth = 480;
        const maxHeight = 360;

        if (width > maxWidth) {
          height = (maxWidth / width) * height;
          width = maxWidth;
        }
        if (height > maxHeight) {
          width = (maxHeight / height) * width;
          height = maxHeight;
        }

        video.style.width = `${width}px`;
        video.style.height = `${height}px`;
      };

      getSlideAppendTarget(innerDiv).appendChild(video);

      saveSlideHtml(true);
      highlightElement(video, true);
      updateSelectedElements([video]);
      setShowPropertyPanel(true);
      setRightPanelTab('property');
      markUnsaved();
      showToast(t('视频插入成功'), 'success');
    } catch (err) {
      console.error('Failed to upload video:', err);
      showToast(t('视频上传失败，请重试'), 'error');
    }

    e.target.value = '';
  };

  const handleFormatBrushCopy = () => {
    if (selectedElementsRef.current.length !== 1) return;

    const element = selectedElementsRef.current[0];
    const computedStyle = window.getComputedStyle(element);

    const styleProps = [
      'fontSize',
      'fontWeight',
      'fontStyle',
      'textDecoration',
      'color',
      'backgroundColor',
      'textAlign',
      'lineHeight',
      'letterSpacing',
    ];

    const data: Record<string, string> = {};
    styleProps.forEach((prop) => {
      data[prop] = (computedStyle as any)[prop];
    });

    setFormatBrushData(data);
    setIsFormatBrushMode(true);
  };

  const handleFormatBrushApply = (element: HTMLElement) => {
    if (!formatBrushData) return;

    Object.entries(formatBrushData).forEach(([prop, value]) => {
      (element.style as any)[prop] = value;
    });

    markUnsaved();
    saveAndRestoreSelection();
  };
  handleFormatBrushApplyRef.current = handleFormatBrushApply;

  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;

    if (target.tagName === 'TD' || target.tagName === 'TH') {
      e.preventDefault();
      e.stopPropagation();
      clearSelection();
      startTableCellEditing(target);
      return;
    }

    const element = findSelectableElement(target, 'inner');

    if (element && isTextElement(element)) {
      e.preventDefault();
      clearSelection();
      startTextEditing(element, e.clientX, e.clientY);
    }
  };

  const saveSlideHtml = (addToHistory: boolean = false, slideId?: string) => {
    const innerDiv = contentRef.current;
    if (!innerDiv || !currentSlide) return;

    _normalizeWhitespaceTextNodes(innerDiv);

    _ensureElementIds(innerDiv);

    const clonedDiv = innerDiv.cloneNode(true) as HTMLElement;
    const selectedEls = clonedDiv.querySelectorAll('.noppt-selected');
    selectedEls.forEach((el) => {
      el.classList.remove('noppt-selected');
    });

    clonedDiv.querySelectorAll('*').forEach((el) => {
      const classAttr = el.getAttribute('class');
      if (classAttr !== null && classAttr.trim() === '') {
        el.removeAttribute('class');
      }
    });

    const textWrappers = clonedDiv.querySelectorAll('.noppt-text-wrapper');
    textWrappers.forEach((wrapper) => {
      const parent = wrapper.parentNode;
      if (parent) {
        while (wrapper.firstChild) {
          parent.insertBefore(wrapper.firstChild, wrapper);
        }
        parent.removeChild(wrapper);
      }
    });

    const html = clonedDiv.innerHTML;
    const targetSlideId = slideId ?? currentSlide.id;
    if (targetSlideId === currentSlide.id) {
      lastSavedHtmlRef.current = html;
    }
    updateSlide(targetSlideId, { html }, addToHistory);
  };
  saveSlideHtmlRef.current = saveSlideHtml;

  const {
    handleBindElements,
    handleUnbindElements,
    alignElements,
    alignSingleElement,
    moveSelectedElements,
    reorderElements,
    bringToFront,
    sendToBack,
    bringForward,
    sendBackward,
    bringToFrontRef,
    sendToBackRef,
    bringForwardRef,
    sendBackwardRef,
  } = useElementOperations({
    currentSlide,
    presentation,
    slideContainerRef,
    selectedElementsRef,
    cleanSelectedElements,
    updateSelectedElements,
    highlightElement,
    saveSlideHtml,
    markUnsaved,
    updateResizeBox,
    saveAndRestoreSelection,
    setShowPropertyPanel,
    setRightPanelTab,
    showToast,
    commitAllSelectedTransforms,
  });

  useEffect(() => {
    if (!contextMenu) return;

    const handlePointerDown = (e: PointerEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [contextMenu]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isEditing =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      if (contextMenu && e.key === 'Escape') {
        e.preventDefault();
        setContextMenu(null);
        return;
      }

      if (isTextEditing && e.key === 'Escape') {
        e.preventDefault();
        stopTextEditing();
        return;
      }

      if (e.key === 'Escape' && (isPasteMode || isFormatBrushMode)) {
        e.preventDefault();
        handleCancelPasteRef.current();
        return;
      }

      if (e.key === 'Escape' && selectedElementsRef.current.length > 0 && !isTextEditing) {
        e.preventDefault();
        clearSelection();
        return;
      }

      if (isEditing && !isTextEditing) return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        redo();
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSaveRef.current();
      }

      if (
        (e.ctrlKey || e.metaKey) &&
        e.key === 'c' &&
        selectedElementsRef.current.length > 0 &&
        !isEditing
      ) {
        e.preventDefault();
        handleCopyElementsRef.current();
      }

      if (
        (e.ctrlKey || e.metaKey) &&
        e.key === 'x' &&
        selectedElementsRef.current.length > 0 &&
        !isEditing
      ) {
        e.preventDefault();
        handleCopyElementsRef.current();
        handleDeleteElementRef.current();
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'v' && !isEditing) {
        if (clipboardElements.length > 0) {
          e.preventDefault();
          handlePasteWithOffset();
        }
      }

      if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        selectedElementsRef.current.length > 0 &&
        !isEditing
      ) {
        e.preventDefault();
        handleDeleteElementRef.current();
      }

      if (
        (e.ctrlKey || e.metaKey) &&
        e.key === ']' &&
        selectedElementsRef.current.length > 0 &&
        !isEditing
      ) {
        e.preventDefault();
        bringForwardRef.current();
      }

      if (
        (e.ctrlKey || e.metaKey) &&
        e.key === '[' &&
        selectedElementsRef.current.length > 0 &&
        !isEditing
      ) {
        e.preventDefault();
        sendBackwardRef.current();
      }

      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        e.key === ']' &&
        selectedElementsRef.current.length > 0 &&
        !isEditing
      ) {
        e.preventDefault();
        bringToFrontRef.current();
      }

      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        e.key === '[' &&
        selectedElementsRef.current.length > 0 &&
        !isEditing
      ) {
        e.preventDefault();
        sendToBackRef.current();
      }

      if (
        e.key === 'Tab' &&
        selectedElementsRef.current.length > 0 &&
        !isEditing &&
        !isTextEditing
      ) {
        e.preventDefault();
        const current = selectedElementsRef.current[0];
        const innerDiv = slideContainerRef.current?.querySelector(
          '[data-slide-content="true"]',
        ) as HTMLElement | null;
        if (!innerDiv) return;

        const allSelectable: HTMLElement[] = [];
        const walk = (el: Element) => {
          if (
            el instanceof HTMLElement &&
            (isTextContent(el) || isVisualContainer(el, innerDiv) || isLayoutContainer(el)) &&
            el !== innerDiv
          ) {
            allSelectable.push(el);
          }
          Array.from(el.children).forEach(walk);
        };
        Array.from(innerDiv.children).forEach(walk);

        const currentIdx = allSelectable.indexOf(current);
        if (currentIdx === -1) return;
        let nextIdx: number;
        if (e.shiftKey) {
          nextIdx = currentIdx > 0 ? currentIdx - 1 : allSelectable.length - 1;
        } else {
          nextIdx = currentIdx < allSelectable.length - 1 ? currentIdx + 1 : 0;
        }
        clearSelection();
        addToSelection(allSelectable[nextIdx]);
      }
    };

    const handlePaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement;
      const isInputFocused =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      if (isTextEditing) {
        return;
      }
      if (isInputFocused) {
        return;
      }
      if (clipboardElements.length > 0 && isPasteMode) {
        e.preventDefault();
        handlePasteWithOffset();
        return;
      }

      e.preventDefault();
      handlePasteEventRef.current(e);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('paste', handlePaste, true);

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'noppt_clipboard_timestamp' && e.newValue) {
        const parts = e.newValue.split('_');
        const sourceTabId = parts[1];
        if (sourceTabId !== tabIdRef.current) {
          setClipboardElements([]);
          setClipboardSourceSlideId(null);
          setIsPasteMode(false);
        }
      }
      if (e.key === 'noppt_clipboard_cleared' && e.newValue) {
        const parts = e.newValue.split('_');
        const sourceTabId = parts[1];
        if (sourceTabId !== tabIdRef.current) {
          setClipboardElements([]);
          setClipboardSourceSlideId(null);
          setIsPasteMode(false);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('paste', handlePaste, true);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [
    undo,
    redo,
    isTextEditing,
    isPasteMode,
    isFormatBrushMode,
    clipboardElements,
    clipboardSourceSlideId,
    contextMenu,
  ]);

  useEffect(() => {
    if (!isTextEditing) return;

    const handleSelectionChange = () => {
      updateSelectionStyles();
    };

    const handleEditorFocus = () => {
      hideFakeSelection();
      if (savedSelectionRangeRef.current) {
        const sel = window.getSelection();
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(savedSelectionRangeRef.current.cloneRange());
        }
      }
    };

    const handleEditorBlur = () => {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && !sel.isCollapsed && editingElementRef.current) {
        const range = sel.getRangeAt(0);
        if (editingElementRef.current.contains(range.startContainer)) {
          savedSelectionRangeRef.current = range.cloneRange();
          showFakeSelection();
        }
      }
    };

    const handleClickOutside = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (!editingElementRef.current) return;

      if (editingElementRef.current.contains(target)) {
        savedSelectionRangeRef.current = null;
        return;
      }

      if (target.closest('[data-property-panel="true"]')) {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
          savedSelectionRangeRef.current = sel.getRangeAt(0).cloneRange();
        }
        return;
      }

      stopTextEditing();
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    document.addEventListener('pointerdown', handleClickOutside);
    editingElementRef.current?.addEventListener('focus', handleEditorFocus);
    editingElementRef.current?.addEventListener('blur', handleEditorBlur);
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
      document.removeEventListener('pointerdown', handleClickOutside);
      editingElementRef.current?.removeEventListener('focus', handleEditorFocus);
      editingElementRef.current?.removeEventListener('blur', handleEditorBlur);
      hideFakeSelection();
    };
  }, [isTextEditing]);

  useEffect(() => {
    if (!iconStyleMenuOpen) return;
    const handleClickOutside = (e: PointerEvent) => {
      if (iconStyleMenuRef.current && !iconStyleMenuRef.current.contains(e.target as Node)) {
        setIconStyleMenuOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIconStyleMenuOpen(false);
    };
    document.addEventListener('pointerdown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('pointerdown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [iconStyleMenuOpen]);

  const handleApplyIconStyle = (style: string) => {
    applyIconStyle(style as any);
    setIconStyleMenuOpen(false);
    showToast(t('图标风格已更新（全局）'), 'success');
  };

  const handleApplyIconStyleToSelection = (style: IconStyle) => {
    setContextMenu(null);
    const rawElements = selectedElementsRef.current;
    if (rawElements.length === 0) {
      showToast(t('请先选中要修改的元素'), 'warning');
      return;
    }

    saveHistory();

    const bestElements = rawElements.map((el) => findBestIconContainer(el));
    const uniqueElements = Array.from(
      new Set(bestElements.filter((el) => el && el.isConnected)),
    ) as HTMLElement[];
    const elementPaths = uniqueElements.map((el) => getElementPath(el));

    let count = replaceIconsInElements(uniqueElements, style);

    if (count === 0 && style !== 'none') {
      count = addIconsToElements(uniqueElements, style).count;
    }

    if (count > 0) {
      markUnsaved();
      saveSlideHtml(true);
      requestAnimationFrame(() => {
        const newSelected: HTMLElement[] = [];
        elementPaths.forEach((path) => {
          const found = path ? getElementByPath(path) : null;
          if (found) {
            highlightElement(found, true);
            newSelected.push(found);
          }
        });
        if (newSelected.length > 0) {
          updateSelectedElements(newSelected);
          setShowPropertyPanel(true);
        }
      });
      showToast(t('已为选中区域添加/更新 {n} 个图标', { n: count }), 'success');
    } else {
      showToast(t('选中区域无可添加图标的文本内容'), 'info');
    }
  };

  const handleApplyIconStyleToCurrentSlide = (style: IconStyle) => {
    setContextMenu(null);
    if (!slideContainerRef.current || !currentSlide) return;

    const innerDiv = slideContainerRef.current.querySelector(
      '[data-slide-content="true"]',
    ) as HTMLElement;
    if (!innerDiv) return;

    saveHistory();

    let count = replaceIconsInElement(innerDiv, style);

    if (count === 0 && style !== 'none') {
      count = findAndAddIconsInSlide(innerDiv, style);
    }

    if (count > 0) {
      markUnsaved();
      saveAndRestoreSelection();
      showToast(t('已为当前页添加/更新 {n} 个图标', { n: count }), 'success');
    } else {
      showToast(t('当前页未找到可替换或添加图标的内容'), 'info');
    }
  };

  const iconStyleOptions: IconStyleOption[] = ICON_STYLE_OPTIONS;

  if (!presentation) return null;

  return (
    <div className="h-screen flex flex-col bg-slate-100 overflow-hidden">
      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - Slide List */}
        <aside className="w-60 bg-white border-r border-slate-200 flex flex-col shrink-0">
          <SlideListPanel />
        </aside>

        {/* Center - Preview Area */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Top Toolbar */}
          <div className="h-14 bg-white border-b border-slate-200 flex items-center px-4 gap-3 shrink-0">
            <button
              onClick={handleBack}
              className="p-2 hover:bg-slate-100 rounded-lg transition-colors shrink-0"
              title={t('返回')}
            >
              <ArrowLeft className="w-5 h-5 text-slate-600" />
            </button>
            <div className="w-px h-6 bg-slate-200" />
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={handleOpenPresentation}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                title={t('打开演示')}
              >
                <FolderOpen className="w-5 h-5 text-slate-600" />
              </button>
              <button
                onClick={handleSave}
                disabled={!hasUnsavedChanges}
                className={`p-2 rounded-lg transition-all ${
                  hasUnsavedChanges
                    ? 'hover:bg-blue-50 text-blue-600 cursor-pointer'
                    : 'text-slate-400 opacity-50 cursor-not-allowed'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
                title={t('保存 (Ctrl+S)')}
              >
                <Save className="w-5 h-5" />
              </button>
              <button
                onClick={() => setExportModal(true)}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                title={t('导出')}
              >
                <Download className="w-5 h-5 text-slate-600" />
              </button>
            </div>
            <div className="w-px h-6 bg-slate-200" />

            <div className="relative flex items-center" ref={iconStyleMenuRef}>
              <button
                onClick={() => setIconStyleMenuOpen(!iconStyleMenuOpen)}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors flex items-center gap-1"
                title={t('图标风格')}
              >
                <Hash className="w-5 h-5 text-slate-600" />
              </button>
              {iconStyleMenuOpen && (
                <div className="absolute top-full left-0 mt-1 bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 py-2 z-50 w-52">
                  <div className="px-3 py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-700 mb-1">
                    {t('全局应用到所有页')}
                  </div>
                  {iconStyleOptions.map((opt) => {
                    const IconComp = opt.icon;
                    return (
                      <button
                        key={opt.id}
                        onClick={() => handleApplyIconStyle(opt.id)}
                        className="w-full px-3 py-2 flex items-center gap-3 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-left"
                      >
                        <IconComp className="w-4 h-4 text-slate-500 dark:text-slate-400 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                            {t(opt.name)}
                          </p>
                          <p className="text-xs text-slate-400 dark:text-slate-500">
                            {t(opt.desc)}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                  <div className="h-px bg-slate-200 dark:bg-slate-700 my-1" />
                  <button
                    onClick={() => {
                      setIconStyleMenuOpen(false);
                      handleApplyIconStyleToCurrentSlide('auto');
                    }}
                    className="w-full px-3 py-2 flex items-center gap-3 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-left"
                  >
                    <Sparkles className="w-4 h-4 text-slate-500 dark:text-slate-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                        {t('仅当前页智能匹配')}
                      </p>
                    </div>
                  </button>
                </div>
              )}
            </div>

            <div className="w-px h-6 bg-slate-200" />

            <div className="flex-1" />

            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={undo}
                disabled={!canUndo}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-30"
                title={t('撤销 (Ctrl+Z)')}
              >
                <Undo2 className="w-5 h-5 text-slate-600" />
              </button>
              <button
                onClick={redo}
                disabled={!canRedo}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-30"
                title={t('重做 (Ctrl+Y)')}
              >
                <Redo2 className="w-5 h-5 text-slate-600" />
              </button>
              <button
                onClick={handleUnbindElements}
                disabled={
                  selectedElements.length === 0 ||
                  !selectedElements.some((el) => el.getAttribute('data-element-type') === 'group')
                }
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-30"
                title={t('解绑 (Ctrl+Shift+G)')}
              >
                <UngroupIcon className="w-5 h-5 text-slate-600" />
              </button>
              <button
                onClick={handleBindElements}
                disabled={selectedElements.length < 2}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-30"
                title={t('绑定 (Ctrl+G)')}
              >
                <GroupIcon className="w-5 h-5 text-slate-600" />
              </button>
              <div className="w-px h-6 bg-slate-200 mx-1" />
              <button
                onClick={() => setShowTableDialog(true)}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                title={t('插入表格')}
              >
                <Table className="w-5 h-5 text-slate-600" />
              </button>
              <button
                onClick={handleInsertImage}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                title={t('插入图片')}
              >
                <ImageIcon className="w-5 h-5 text-slate-600" />
              </button>
              <button
                onClick={handleInsertVideo}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                title={t('插入视频')}
              >
                <Video className="w-5 h-5 text-slate-600" />
              </button>
              <div className="w-px h-6 bg-slate-200 mx-1" />
              <button
                onClick={handlePreview}
                className="inline-flex items-center gap-2 px-3 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors text-sm font-medium"
                title={t('演示')}
              >
                <Play className="w-4 h-4" />
                {t('演示')}
              </button>
              <div className="w-px h-6 bg-slate-200 mx-1" />
              <button
                onClick={() => {
                  userZoomOverrideRef.current = true;
                  setZoom(zoom - 0.1);
                }}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                title={t('缩小')}
              >
                <ZoomOut className="w-5 h-5 text-slate-600" />
              </button>
              <input
                type="range"
                min="0.25"
                max="2"
                step="0.05"
                value={zoom}
                onChange={(e) => {
                  userZoomOverrideRef.current = true;
                  setZoom(parseFloat(e.target.value));
                }}
                onPointerDown={() => {
                  userZoomOverrideRef.current = true;
                }}
                className="w-28 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
              <button
                onClick={() => {
                  userZoomOverrideRef.current = true;
                  setZoom(zoom + 0.1);
                }}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                title={t('放大')}
              >
                <ZoomIn className="w-5 h-5 text-slate-600" />
              </button>
              <span className="text-sm text-slate-600 min-w-[56px] text-center">
                {Math.round(zoom * 100)}%
              </span>
            </div>
          </div>

          {/* Slide Preview */}
          <div
            ref={editorAreaRef}
            className="flex-1 overflow-auto flex items-center justify-center p-8 bg-slate-200"
          >
            <div
              ref={slideContainerRef}
              className="bg-white shadow-2xl rounded-lg overflow-hidden shrink-0 cursor-pointer relative select-none"
              style={{
                width: `${presentation?.width || 1280}px`,
                height: `${presentation?.height || 720}px`,
                transform: `scale(${zoom})`,
                transformOrigin: 'center',
                touchAction: 'none',
              }}
              data-slide-zoom={zoom}
              onPointerDown={handleSlidePointerDown}
              onPointerMove={handleSlidePointerMove}
              onPointerUp={handleSlidePointerUp}
              onPointerLeave={handleSlidePointerUp}
              onDoubleClick={handleDoubleClick}
              onContextMenu={handleContextMenu}
            >
              {currentSlide && (
                <div
                  ref={contentRef}
                  className="w-full h-full"
                  style={{ position: 'relative' }}
                  data-slide-content="true"
                />
              )}
              {selectionBox && (
                <div
                  className="absolute border-2 border-blue-500 bg-blue-500/10 pointer-events-none"
                  style={{
                    left: `${selectionBox.x}px`,
                    top: `${selectionBox.y}px`,
                    width: `${selectionBox.width}px`,
                    height: `${selectionBox.height}px`,
                    zIndex: 9999,
                  }}
                />
              )}
              <SelectionOverlay
                selectedElements={selectedElements}
                zoom={zoom}
                slideContainerRef={slideContainerRef}
                resizeBox={resizeBox}
                isTextEditing={isTextEditing}
              />
              <GuidesOverlay guides={guides} />
            </div>
          </div>
        </main>

        {/* Right Sidebar */}
        <aside
          ref={propertyPanelRef}
          className="w-[360px] shrink-0 flex flex-col h-full bg-white border-l border-slate-200"
        >
          {/* Tab Header */}
          <div className="flex border-b border-slate-200">
            <button
              onClick={() => {
                if (selectedElements.length > 0 || isTextEditing) {
                  setRightPanelTab('property');
                }
              }}
              className={`flex-1 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                rightPanelTab === 'property'
                  ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50'
                  : selectedElements.length > 0 || isTextEditing
                    ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                    : 'text-slate-300 cursor-not-allowed'
              }`}
              disabled={selectedElements.length === 0 && !isTextEditing}
            >
              <Settings className="w-4 h-4" />
              {t('元素属性')}
            </button>
            <button
              onClick={() => setRightPanelTab('ai')}
              className={`flex-1 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                rightPanelTab === 'ai'
                  ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <Sparkles className="w-4 h-4" />
              {t('AI 助手')}
            </button>
          </div>

          {/* Selection Breadcrumb */}
          {selectedElements.length > 0 && !isTextEditing && (
            <SelectionBreadcrumb
              selectedElement={selectedElements[0]}
              onSelectElement={(el) => {
                clearSelection();
                addToSelection(el);
              }}
              onSelectSlide={() => {
                clearSelection();
              }}
            />
          )}

          {/* Tab Content */}
          <div className="flex-1 overflow-hidden">
            {rightPanelTab === 'property' &&
            ((showPropertyPanel && selectedElements.length > 0) || isTextEditing) ? (
              <PropertyPanel
                selectedElements={selectedElements}
                onClose={isTextEditing ? stopTextEditing : clearSelection}
                onDelete={handleDeleteElement}
                onChange={handlePropertyChange}
                onAlign={alignElements}
                onAlignSingle={alignSingleElement}
                onMove={moveSelectedElements}
                onCopy={handleCopyElements}
                onCancelPaste={handleCancelPaste}
                onFormatBrush={handleFormatBrushCopy}
                onSplitText={splitTextElement}
                onBringToFront={bringToFront}
                onSendToBack={sendToBack}
                onBringForward={bringForward}
                onSendBackward={sendBackward}
                isPasteMode={isPasteMode}
                isFormatBrushMode={isFormatBrushMode}
                isTextEditing={isTextEditing}
                keepAspectRatio={keepAspectRatio}
                onKeepAspectRatioChange={setKeepAspectRatio}
                selectionStyles={selectionStyles}
                onSelectionFontSize={applyFontSizeToSelection}
                onSelectionBold={applyBoldToSelection}
                onSelectionItalic={applyItalicToSelection}
                onSelectionUnderline={applyUnderlineToSelection}
                onSelectionStrikethrough={applyStrikethroughToSelection}
                onSelectionColor={applyColorToSelection}
                onSelectionBackgroundColor={applyBackgroundColorToSelection}
                onSelectionFontFamily={applyFontFamilyToSelection}
                onSelectionAlign={applyAlignToSelection}
                onSelectionUnorderedList={handleSelectionUnorderedList}
                onSelectionOrderedList={handleSelectionOrderedList}
                onSelectionListStyleType={handleSelectionListStyleType}
                onSelectionListWithStyle={applyListWithStyle}
                onSelectionIconStyle={handleApplyIconStyleToSelection}
                selectionListType={selectionListType}
                selectionListStyleType={selectionListStyleType}
                bulletStyles={BULLET_STYLES}
                numberStyles={NUMBER_STYLES}
              />
            ) : rightPanelTab === 'ai' ? (
              <AIChatPanel
                selectedElements={selectedElements}
                hasSelection={selectedElements.length > 0 || isTextEditing}
              />
            ) : null}
          </div>
        </aside>
      </div>

      {showTableDialog && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
          onClick={() => setShowTableDialog(false)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-80 p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-slate-800 mb-4">{t('插入表格')}</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1.5">
                  {t('行数')}
                </label>
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={tableRows}
                  onChange={(e) =>
                    setTableRows(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))
                  }
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1.5">
                  {t('列数')}
                </label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={tableCols}
                  onChange={(e) =>
                    setTableCols(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))
                  }
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setShowTableDialog(false)}
                className="flex-1 py-2 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-lg transition-colors text-sm font-medium"
              >
                {t('取消')}
              </button>
              <button
                onClick={handleInsertTable}
                className="flex-1 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-lg transition-colors text-sm font-medium"
              >
                {t('插入')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showPresentationList && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
          onClick={() => setShowPresentationList(false)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-[500px] max-h-[70vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <h3 className="text-base font-semibold text-slate-800">{t('打开演示')}</h3>
              <button
                onClick={() => setShowPresentationList(false)}
                className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {presentations.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-sm">{t('暂无演示文稿')}</div>
              ) : (
                <div className="space-y-2">
                  {presentations.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => handleSelectPresentation(item.id)}
                      className={`w-full text-left p-3 rounded-lg transition-colors flex items-center gap-3 ${
                        item.id === presentation?.id
                          ? 'bg-blue-50 border border-blue-200'
                          : 'hover:bg-slate-50 border border-transparent'
                      }`}
                    >
                      <div className="w-12 h-12 bg-slate-100 rounded-lg flex items-center justify-center shrink-0">
                        <Settings className="w-6 h-6 text-slate-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-slate-800 truncate">{item.title}</div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          {item.slideCount} {t('页')} ·{' '}
                          {new Date(item.updatedAt).toLocaleDateString()}
                        </div>
                      </div>
                      {item.id === presentation?.id && (
                        <span className="text-xs text-blue-600 font-medium shrink-0">
                          {t('当前')}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 bg-white rounded-lg shadow-xl border border-slate-200 py-1 min-w-[160px]"
          style={{
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.type === 'element' && (
            <>
              <button
                onClick={handleCutFromMenu}
                className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
              >
                <Scissors className="w-4 h-4" />
                {t('剪切')}
              </button>
              <button
                onClick={handleCopyFromMenu}
                className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
              >
                <Copy className="w-4 h-4" />
                {t('复制')}
              </button>
              {contextMenu.hasElementClipboard && (
                <button
                  onClick={handlePasteFromMenu}
                  className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
                >
                  <ClipboardPaste className="w-4 h-4" />
                  {t('粘贴元素')}
                </button>
              )}
              {contextMenu.hasElementClipboard && (
                <button
                  onClick={() => handlePasteAsImage(contextMenu.x, contextMenu.y)}
                  className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
                >
                  <ImageIcon className="w-4 h-4" />
                  {t('粘贴为绑定对象')}
                </button>
              )}
              {contextMenu.hasSlideClipboard && (
                <button
                  onClick={() => handlePasteSlideAsImage(contextMenu.x, contextMenu.y)}
                  className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
                >
                  <ImageIcon className="w-4 h-4" />
                  {t('粘贴幻灯片为绑定对象')}
                </button>
              )}
              {contextMenu.hasTextClipboard &&
                !contextMenu.hasElementClipboard &&
                !contextMenu.hasSlideClipboard && (
                  <button
                    onClick={() => handlePasteText(contextMenu.x, contextMenu.y)}
                    className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
                  >
                    <Type className="w-4 h-4" />
                    {t('粘贴为文本')}
                  </button>
                )}
              {contextMenu.hasHtmlClipboard &&
                !contextMenu.hasElementClipboard &&
                !contextMenu.hasSlideClipboard && (
                  <button
                    onClick={() => handlePasteHtml(contextMenu.x, contextMenu.y)}
                    className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
                  >
                    <Table2 className="w-4 h-4" />
                    {t('粘贴为表格')}
                  </button>
                )}
              {contextMenu.hasImageClipboard &&
                !contextMenu.hasElementClipboard &&
                !contextMenu.hasSlideClipboard && (
                  <button
                    onClick={() => handlePasteImage(contextMenu.x, contextMenu.y)}
                    className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
                  >
                    <ImageIcon className="w-4 h-4" />
                    {t('粘贴图片')}
                  </button>
                )}
              <div className="h-px bg-slate-200 my-1" />
              <button
                onClick={handleDeleteElementFromMenu}
                className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
              >
                <Trash2 className="w-4 h-4" />
                {t('删除')}
              </button>
            </>
          )}
          {contextMenu.type === 'slide' && (
            <>
              {contextMenu.hasElementClipboard && (
                <button
                  onClick={handlePasteFromMenu}
                  className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
                >
                  <ClipboardPaste className="w-4 h-4" />
                  {t('粘贴元素')}
                </button>
              )}
              {contextMenu.hasElementClipboard && (
                <button
                  onClick={() => handlePasteAsImage(contextMenu.x, contextMenu.y)}
                  className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
                >
                  <ImageIcon className="w-4 h-4" />
                  {t('粘贴为绑定对象')}
                </button>
              )}
              {contextMenu.hasSlideClipboard && (
                <button
                  onClick={() => handlePasteSlideAsImage(contextMenu.x, contextMenu.y)}
                  className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
                >
                  <ImageIcon className="w-4 h-4" />
                  {t('粘贴幻灯片为绑定对象')}
                </button>
              )}
              {contextMenu.hasTextClipboard &&
                !contextMenu.hasElementClipboard &&
                !contextMenu.hasSlideClipboard && (
                  <button
                    onClick={() => handlePasteText(contextMenu.x, contextMenu.y)}
                    className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
                  >
                    <Type className="w-4 h-4" />
                    {t('粘贴为文本')}
                  </button>
                )}
              {contextMenu.hasHtmlClipboard &&
                !contextMenu.hasElementClipboard &&
                !contextMenu.hasSlideClipboard && (
                  <button
                    onClick={() => handlePasteHtml(contextMenu.x, contextMenu.y)}
                    className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
                  >
                    <Table2 className="w-4 h-4" />
                    {t('粘贴为表格')}
                  </button>
                )}
              {contextMenu.hasImageClipboard &&
                !contextMenu.hasElementClipboard &&
                !contextMenu.hasSlideClipboard && (
                  <button
                    onClick={() => handlePasteImage(contextMenu.x, contextMenu.y)}
                    className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
                  >
                    <ImageIcon className="w-4 h-4" />
                    {t('粘贴图片')}
                  </button>
                )}
              <div className="h-px bg-slate-200 my-1" />
              <div className="px-2 py-1">
                <p className="px-2 py-1 text-xs font-medium text-slate-400 uppercase tracking-wider">
                  {t('图标风格（当前页）')}
                </p>
                {iconStyleOptions.map((opt) => {
                  const IconComp = opt.icon;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => handleApplyIconStyleToCurrentSlide(opt.id as IconStyle)}
                      className="w-full px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2 rounded"
                    >
                      <IconComp className="w-4 h-4 text-slate-500" />
                      <span>{t(opt.name)}</span>
                      <span className="text-xs text-slate-400 ml-auto">{t(opt.desc)}</span>
                    </button>
                  );
                })}
              </div>
              {!contextMenu.hasElementClipboard &&
                !contextMenu.hasSlideClipboard &&
                !contextMenu.hasTextClipboard &&
                !contextMenu.hasHtmlClipboard &&
                !contextMenu.hasImageClipboard && <div className="h-px bg-slate-200 my-1" />}
              {!contextMenu.hasElementClipboard &&
                !contextMenu.hasSlideClipboard &&
                !contextMenu.hasTextClipboard &&
                !contextMenu.hasHtmlClipboard &&
                !contextMenu.hasImageClipboard && (
                  <div className="px-4 py-2 text-sm text-slate-400 text-center">
                    {t('剪贴板为空')}
                  </div>
                )}
            </>
          )}
        </div>
      )}

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageFile}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={handleVideoFile}
      />
    </div>
  );
}
