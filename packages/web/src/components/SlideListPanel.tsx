import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Plus,
  Copy,
  Clipboard,
  Trash2,
  GripVertical,
  Edit3,
  ExternalLink,
  Scissors,
  ImageIcon,
  ImageOff,
  Pencil,
} from 'lucide-react';
import { usePresentationStore } from '@/stores/presentation';
import { useUIStore } from '@/stores/ui';
import { cn } from '@/utils/cn';
import { safeHtml } from '@/utils';
import { presentationApi } from '@/utils/api';
import type { Slide } from '@noppt/core';
import { useI18n, t } from '@/i18n';
export default function SlideListPanel() {
  const { t } = useI18n();
  const presentation = usePresentationStore((s) => s.presentation);
  const selectedSlideId = usePresentationStore((s) => s.presentation?.selectedSlideId);
  const selectSlide = usePresentationStore((s) => s.selectSlide);
  const addSlide = usePresentationStore((s) => s.addSlide);
  const duplicateSlide = usePresentationStore((s) => s.duplicateSlide);
  const removeSlide = usePresentationStore((s) => s.removeSlide);
  const bulkRemoveSlides = usePresentationStore((s) => s.bulkRemoveSlides);
  const moveSlide = usePresentationStore((s) => s.moveSlide);
  const bulkMoveSlides = usePresentationStore((s) => s.bulkMoveSlides);
  const updateSlide = usePresentationStore((s) => s.updateSlide);
  const updatePresentation = usePresentationStore((s) => s.updatePresentation);
  const pasteSlide = usePresentationStore((s) => s.pasteSlide);
  const bulkPasteSlides = usePresentationStore((s) => s.bulkPasteSlides);
  const setSlideBackground = usePresentationStore((s) => s.setSlideBackground);
  const removeSlideBackground = usePresentationStore((s) => s.removeSlideBackground);
  const setAllSlideBackgrounds = usePresentationStore((s) => s.setAllSlideBackgrounds);
  const removeAllSlideBackgrounds = usePresentationStore((s) => s.removeAllSlideBackgrounds);
  const showToast = useUIStore((s) => s.showToast);
  const [selectedSlideIds, setSelectedSlideIds] = useState<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number>(0);
  const [contextMenu, setContextMenu] = useState<{
    slideId: string;
    x: number;
    y: number;
  } | null>(null);
  const [blankAreaContextMenu, setBlankAreaContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [canPasteSlide, setCanPasteSlide] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [isEditingPresTitle, setIsEditingPresTitle] = useState(false);
  const [editPresTitle, setEditPresTitle] = useState('');
  const presTitleInputRef = useRef<HTMLInputElement>(null);
  const [draggedIds, setDraggedIds] = useState<Set<string> | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dragPosition, setDragPosition] = useState<'before' | 'after'>('after');
  const menuRef = useRef<HTMLDivElement>(null);
  const blankMenuRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const thumbnailMeasureRef = useRef<HTMLDivElement>(null);
  const bgInputRef = useRef<HTMLInputElement>(null);
  const bgAllInputRef = useRef<HTMLInputElement>(null);
  const bgTargetRef = useRef<'single' | 'all'>('single');
  const bgSlideIdRef = useRef<string>('');
  const [thumbnailScale, setThumbnailScale] = useState(0.15);
  useEffect(() => {
    if (selectedSlideId && !selectedSlideIds.has(selectedSlideId)) {
      setSelectedSlideIds(new Set([selectedSlideId]));
    }
  }, [selectedSlideId]);
  useEffect(() => {
    const updateThumbnailScale = () => {
      if (thumbnailMeasureRef.current && presentation) {
        const width = thumbnailMeasureRef.current.offsetWidth;
        const sWidth = presentation.width || 1280;
        if (width > 0 && sWidth > 0) {
          setThumbnailScale(width / sWidth);
        }
      }
    };
    updateThumbnailScale();
    const observer = new ResizeObserver(updateThumbnailScale);
    if (thumbnailMeasureRef.current) {
      observer.observe(thumbnailMeasureRef.current);
    }
    return () => observer.disconnect();
  }, [presentation]);
  useEffect(() => {
    const handleClickOutside = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
      if (blankMenuRef.current && !blankMenuRef.current.contains(e.target as Node)) {
        setBlankAreaContextMenu(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu(null);
        setBlankAreaContextMenu(null);
      }
    };
    if (contextMenu || blankAreaContextMenu) {
      window.addEventListener('pointerdown', handleClickOutside);
      window.addEventListener('keydown', handleKeyDown);
      return () => {
        window.removeEventListener('pointerdown', handleClickOutside);
        window.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [contextMenu, blankAreaContextMenu]);
  const handleCopySlides = useCallback(
    async (slideIds: string[]) => {
      if (!presentation || slideIds.length === 0) return;
      const slides = slideIds
        .map((id) => presentation.slides.find((s) => s.id === id))
        .filter(Boolean) as Slide[];
      if (slides.length === 0) return;
      const slidesJson = JSON.stringify(slides);
      try {
        try {
          const customType = new Blob([slidesJson], { type: 'application/x-noppt-slides' });
          const singleType = new Blob([JSON.stringify(slides[0])], {
            type: 'application/x-noppt-slide',
          });
          const textType = new Blob([`__noppt_slides__:${slidesJson}`], { type: 'text/plain' });
          await navigator.clipboard.write([
            new ClipboardItem({
              'application/x-noppt-slides': customType,
              'application/x-noppt-slide': singleType,
              'text/plain': textType,
            }),
          ]);
        } catch {
          await navigator.clipboard.writeText(`__noppt_slides__:${slidesJson}`);
        }
        try {
          const tabId = Math.random().toString(36).substring(2, 10);
          localStorage.setItem('noppt_clipboard_timestamp', `${Date.now()}_${tabId}`);
        } catch {
          // ignore
        }
        showToast(t('已复制 {n} 张幻灯片', { n: slides.length }), 'success');
      } catch {
        showToast(t('复制失败'), 'error');
      }
    },
    [presentation, showToast],
  );
  const handleCutSlides = useCallback(
    async (slideIds: string[]) => {
      if (!presentation) return;
      if (slideIds.length >= presentation.slides.length) {
        showToast(t('至少保留一张幻灯片'), 'error');
        return;
      }
      await handleCopySlides(slideIds);
      bulkRemoveSlides(slideIds);
      showToast(t('已剪切 {n} 张幻灯片', { n: slideIds.length }), 'success');
    },
    [presentation, handleCopySlides, bulkRemoveSlides, showToast],
  );
  const handleDeleteSlides = useCallback(
    (slideIds: string[]) => {
      if (!presentation) return;
      if (slideIds.length >= presentation.slides.length) {
        showToast(t('至少保留一张幻灯片'), 'error');
        return;
      }
      bulkRemoveSlides(slideIds);
      setSelectedSlideIds(new Set());
      showToast(t('已删除 {n} 张幻灯片', { n: slideIds.length }), 'success');
    },
    [presentation, bulkRemoveSlides, showToast],
  );
  const handlePasteSlides = useCallback(
    async (insertIndex?: number) => {
      if (!presentation) return;
      try {
        let slidesData: Slide[] | null = null;
        try {
          const clipboardItems = await navigator.clipboard.read();
          for (const item of clipboardItems) {
            if (item.types.includes('application/x-noppt-slides')) {
              const blob = await item.getType('application/x-noppt-slides');
              const text = await blob.text();
              const parsed = JSON.parse(text);
              if (Array.isArray(parsed) && parsed.length > 0) {
                slidesData = parsed;
                break;
              }
            }
            if (item.types.includes('application/x-noppt-slide')) {
              const blob = await item.getType('application/x-noppt-slide');
              const text = await blob.text();
              const parsed = JSON.parse(text);
              if (parsed && typeof parsed === 'object' && 'id' in parsed && 'html' in parsed) {
                slidesData = [parsed];
                break;
              }
            }
          }
        } catch {
          // fallback to text
        }
        if (!slidesData) {
          const text = await navigator.clipboard.readText();
          if (text.startsWith('__noppt_slides__:')) {
            const jsonStr = text.slice('__noppt_slides__:'.length);
            const parsed = JSON.parse(jsonStr);
            if (Array.isArray(parsed) && parsed.length > 0) {
              slidesData = parsed;
            }
          } else if (text.startsWith('__noppt_slide__:')) {
            const jsonStr = text.slice('__noppt_slide__:'.length);
            const parsed = JSON.parse(jsonStr);
            if (parsed && typeof parsed === 'object' && 'id' in parsed && 'html' in parsed) {
              slidesData = [parsed];
            }
          } else {
            try {
              const parsed = JSON.parse(text);
              if (parsed && typeof parsed === 'object' && 'id' in parsed && 'html' in parsed) {
                slidesData = [parsed];
              }
            } catch {
              // not valid JSON
            }
          }
        }
        if (slidesData && slidesData.length > 0) {
          if (slidesData.length === 1) {
            pasteSlide(slidesData[0], insertIndex);
          } else {
            bulkPasteSlides(slidesData, insertIndex);
          }
          showToast(t('已粘贴 {n} 张幻灯片', { n: slidesData.length }), 'success');
          try {
            // 优先使用 ClipboardItem 一次性清空所有写入过的 MIME 类型
            await navigator.clipboard.write([
              new ClipboardItem({
                'text/plain': new Blob([''], { type: 'text/plain' }),
                'text/html': new Blob([''], { type: 'text/html' }),
                'image/png': new Blob([], { type: 'image/png' }),
                'application/x-noppt-slide': new Blob([''], { type: 'application/x-noppt-slide' }),
                'application/x-noppt-slides': new Blob([''], {
                  type: 'application/x-noppt-slides',
                }),
              }),
            ]);
          } catch {
            // 降级：退化为空文本
            try {
              await navigator.clipboard.writeText('');
            } catch (e) {
              console.warn('Failed to clear system clipboard:', e);
            }
          }
          // 发送跨标签页清除信号，通知 EditorLayout 等组件同步清空内部剪贴板状态
          try {
            const tabId = Math.random().toString(36).substring(2, 10);
            localStorage.setItem('noppt_clipboard_cleared', `${Date.now()}_${tabId}`);
          } catch {
            // ignore
          }
        } else {
          showToast(t('剪贴板中没有幻灯片数据'), 'error');
        }
      } catch {
        showToast(t('粘贴失败'), 'error');
      }
      setContextMenu(null);
      setBlankAreaContextMenu(null);
    },
    [presentation, pasteSlide, bulkPasteSlides, showToast],
  );
  const checkClipboardHasSlide = async (): Promise<boolean> => {
    try {
      try {
        const clipboardItems = await navigator.clipboard.read();
        for (const item of clipboardItems) {
          if (
            item.types.includes('application/x-noppt-slide') ||
            item.types.includes('application/x-noppt-slides')
          ) {
            return true;
          }
        }
      } catch {
        // fallback to text
      }
      const text = await navigator.clipboard.readText();
      if (text.startsWith('__noppt_slide__:') || text.startsWith('__noppt_slides__:')) {
        return true;
      }
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object' && 'id' in parsed && 'html' in parsed) {
          return true;
        }
        if (
          Array.isArray(parsed) &&
          parsed.length > 0 &&
          parsed[0] &&
          'id' in parsed[0] &&
          'html' in parsed[0]
        ) {
          return true;
        }
      } catch {
        // not valid JSON but not a slide
      }
      return false;
    } catch {
      return false;
    }
  };
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (editingId) return;
      const panel = panelRef.current;
      if (!panel) return;
      const isTargetInPanel = panel.contains(e.target as Node);
      const isPanelFocused = document.activeElement === panel;
      if (!isTargetInPanel && !isPanelFocused) return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault();
        e.stopPropagation();
        const ids =
          selectedSlideIds.size > 0
            ? Array.from(selectedSlideIds)
            : selectedSlideId
              ? [selectedSlideId]
              : [];
        if (ids.length > 0) {
          await handleCopySlides(ids);
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
        e.preventDefault();
        e.stopPropagation();
        const ids =
          selectedSlideIds.size > 0
            ? Array.from(selectedSlideIds)
            : selectedSlideId
              ? [selectedSlideId]
              : [];
        if (ids.length > 0) {
          await handleCutSlides(ids);
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        e.preventDefault();
        e.stopPropagation();
        const currentIdx = presentation?.slides.findIndex((s) => s.id === selectedSlideId) ?? -1;
        const insertIdx = currentIdx >= 0 ? currentIdx + 1 : undefined;
        await handlePasteSlides(insertIdx);
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        const ids =
          selectedSlideIds.size > 0
            ? Array.from(selectedSlideIds)
            : selectedSlideId
              ? [selectedSlideId]
              : [];
        if (ids.length > 0) {
          handleDeleteSlides(ids);
        }
      }
      if (e.key === 'Escape') {
        setContextMenu(null);
        setBlankAreaContextMenu(null);
        setEditingId(null);
        setSelectedSlideIds(new Set(selectedSlideId ? [selectedSlideId] : []));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        if (selectedSlideId && presentation) {
          const currentIndex = presentation.slides.findIndex((s) => s.id === selectedSlideId);
          if (currentIndex > 0) {
            const prevSlide = presentation.slides[currentIndex - 1];
            selectSlide(prevSlide.id);
          }
        }
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        if (selectedSlideId && presentation) {
          const currentIndex = presentation.slides.findIndex((s) => s.id === selectedSlideId);
          if (currentIndex >= 0 && currentIndex < presentation.slides.length - 1) {
            const nextSlide = presentation.slides[currentIndex + 1];
            selectSlide(nextSlide.id);
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [
    presentation,
    selectedSlideId,
    selectedSlideIds,
    editingId,
    handleCopySlides,
    handleCutSlides,
    handleDeleteSlides,
    handlePasteSlides,
  ]);
  if (!presentation) return null;
  const slideWidth = presentation.width || 1280;
  const slideHeight = presentation.height || 720;
  const handleSlideClick = (e: React.MouseEvent, slideId: string, index: number) => {
    if (editingId) return;
    panelRef.current?.focus();
    if (e.shiftKey) {
      e.preventDefault();
      const start = Math.min(lastSelectedIndex, index);
      const end = Math.max(lastSelectedIndex, index);
      const newSelected = new Set<string>();
      for (let i = start; i <= end; i++) {
        newSelected.add(presentation.slides[i].id);
      }
      setSelectedSlideIds(newSelected);
    } else if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const newSelected = new Set(selectedSlideIds);
      if (newSelected.has(slideId)) {
        newSelected.delete(slideId);
        if (newSelected.size === 0 && selectedSlideId) {
          newSelected.add(selectedSlideId);
        }
      } else {
        newSelected.add(slideId);
      }
      setSelectedSlideIds(newSelected);
      setLastSelectedIndex(index);
    } else {
      setSelectedSlideIds(new Set([slideId]));
      setLastSelectedIndex(index);
    }
    selectSlide(slideId);
  };
  const handleContextMenu = async (e: React.MouseEvent, slideId: string, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    panelRef.current?.focus();
    if (!selectedSlideIds.has(slideId)) {
      setSelectedSlideIds(new Set([slideId]));
      setLastSelectedIndex(index);
      selectSlide(slideId);
    }
    const hasSlide = await checkClipboardHasSlide();
    setCanPasteSlide(hasSlide);
    setBlankAreaContextMenu(null);
    setContextMenu({ slideId, x: e.clientX, y: e.clientY });
  };
  const handleBlankAreaContextMenu = async (e: React.MouseEvent) => {
    e.preventDefault();
    const hasSlide = await checkClipboardHasSlide();
    setCanPasteSlide(hasSlide);
    setContextMenu(null);
    setBlankAreaContextMenu({ x: e.clientX, y: e.clientY });
  };
  const handleDelete = () => {
    if (!contextMenu) return;
    const ids = selectedSlideIds.size > 0 ? Array.from(selectedSlideIds) : [contextMenu.slideId];
    handleDeleteSlides(ids);
    setContextMenu(null);
  };
  const handleCopyClick = async () => {
    if (!contextMenu) return;
    const ids = selectedSlideIds.size > 0 ? Array.from(selectedSlideIds) : [contextMenu.slideId];
    await handleCopySlides(ids);
    setContextMenu(null);
  };
  const handleCutClick = async () => {
    if (!contextMenu) return;
    const ids = selectedSlideIds.size > 0 ? Array.from(selectedSlideIds) : [contextMenu.slideId];
    await handleCutSlides(ids);
    setContextMenu(null);
  };
  const handlePasteClick = () => {
    if (!contextMenu) return;
    const slideIndex = presentation.slides.findIndex((s) => s.id === contextMenu.slideId);
    handlePasteSlides(slideIndex >= 0 ? slideIndex + 1 : undefined);
  };
  const handleOpenInNewTab = async () => {
    if (!presentation || !contextMenu) return;
    try {
      const ids = selectedSlideIds.size > 0 ? selectedSlideIds : new Set([contextMenu.slideId]);
      const slides = presentation.slides.filter((s) => ids.has(s.id));
      if (slides.length === 0) {
        setContextMenu(null);
        return;
      }
      const newPres = await presentationApi.create({
        title: presentation.title + t(' - 副本'),
        width: presentation.width,
        height: presentation.height,
      });
      const now = Date.now();
      const newSlides: Slide[] = slides.map((slide, i) => ({
        ...slide,
        id: `${now}-${Math.random().toString(36).slice(2, 9)}-${i}`,
        index: i,
      }));
      const updatedPres = {
        ...newPres,
        slides: newSlides,
        selectedSlideId: newSlides[0]?.id,
        updatedAt: Date.now(),
      };
      await presentationApi.save(updatedPres.id, updatedPres);
      window.open(`/editor/${updatedPres.id}`, '_blank');
      setContextMenu(null);
    } catch (e) {
      console.error('Failed to open in new tab:', e);
      showToast(t('打开失败，请重试'), 'error');
    }
  };
  const handleStartRename = () => {
    if (contextMenu) {
      const slide = presentation.slides.find((s) => s.id === contextMenu.slideId);
      if (slide) {
        setEditingId(slide.id);
        setEditTitle(slide.title);
      }
      setContextMenu(null);
    }
  };
  const handleSaveRename = () => {
    if (editingId) {
      const newTitle = editTitle.trim() || t('未命名幻灯片');
      updateSlide(editingId, { title: newTitle });
      setEditingId(null);
    }
  };
  const handleBgFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      if (bgTargetRef.current === 'all') {
        setAllSlideBackgrounds(dataUrl);
        showToast(t('已为所有幻灯片设置背景图'), 'success');
      } else if (bgSlideIdRef.current) {
        setSlideBackground(bgSlideIdRef.current, dataUrl);
        showToast(t('已为当前幻灯片设置背景图'), 'success');
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };
  const handleSetSingleBg = () => {
    if (!contextMenu) return;
    bgTargetRef.current = 'single';
    bgSlideIdRef.current = contextMenu.slideId;
    setContextMenu(null);
    setTimeout(() => bgInputRef.current?.click(), 50);
  };
  const handleSetAllBg = () => {
    bgTargetRef.current = 'all';
    setContextMenu(null);
    setBlankAreaContextMenu(null);
    setTimeout(() => bgAllInputRef.current?.click(), 50);
  };
  const handleRemoveSingleBg = () => {
    if (!contextMenu) return;
    removeSlideBackground(contextMenu.slideId);
    showToast(t('已移除当前幻灯片背景图'), 'success');
    setContextMenu(null);
  };
  const handleRemoveAllBg = () => {
    removeAllSlideBackgrounds();
    showToast(t('已移除所有幻灯片背景图'), 'success');
    setContextMenu(null);
    setBlankAreaContextMenu(null);
  };
  const handleDragStart = (e: React.DragEvent, slideId: string) => {
    const ids = selectedSlideIds.has(slideId) ? new Set(selectedSlideIds) : new Set([slideId]);
    setDraggedIds(ids);
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragOver = (e: React.DragEvent, slideId: string) => {
    e.preventDefault();
    if (draggedIds?.has(slideId)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const position = e.clientY < midY ? 'before' : 'after';
    setDragOverId(slideId);
    setDragPosition(position);
  };
  const handleDragLeave = () => {
    setDragOverId(null);
  };
  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggedIds || draggedIds.size === 0) {
      setDraggedIds(null);
      setDragOverId(null);
      return;
    }
    if (draggedIds.has(targetId)) {
      setDraggedIds(null);
      setDragOverId(null);
      return;
    }
    const targetIndex = presentation.slides.findIndex((s) => s.id === targetId);
    if (targetIndex === -1) {
      setDraggedIds(null);
      setDragOverId(null);
      return;
    }
    const dragArray = Array.from(draggedIds);
    const firstDragIndex = presentation.slides.findIndex((s) => draggedIds.has(s.id));
    let insertIndex = dragPosition === 'before' ? targetIndex : targetIndex + 1;
    if (firstDragIndex < insertIndex) {
      const countBefore = dragArray.filter((id) => {
        const idx = presentation.slides.findIndex((s) => s.id === id);
        return idx < insertIndex;
      }).length;
      insertIndex -= countBefore;
    }
    if (draggedIds.size === 1) {
      const [singleId] = dragArray;
      moveSlide(singleId, insertIndex);
    } else {
      bulkMoveSlides(dragArray, insertIndex);
    }
    setDraggedIds(null);
    setDragOverId(null);
  };
  const handleDragEnd = () => {
    setDraggedIds(null);
    setDragOverId(null);
  };
  const selectedCount = selectedSlideIds.size;
  const startEditingPresTitle = () => {
    if (!presentation) return;
    setEditPresTitle(presentation.title);
    setIsEditingPresTitle(true);
    setTimeout(() => {
      presTitleInputRef.current?.focus();
      presTitleInputRef.current?.select();
    }, 0);
  };
  const finishEditingPresTitle = async () => {
    if (!presentation) return;
    const newTitle = editPresTitle.trim();
    setIsEditingPresTitle(false);
    if (!newTitle || newTitle === presentation.title) return;
    try {
      // 标题修改只走 PATCH 轻量接口，不发送整个 slides body
      // 避免12+页大演示时PUT大body触发Vite代理的EPIPE/EACCES错误
      await presentationApi.updateMeta(presentation.id, { title: newTitle });
      // 更新store中展示值，markUnsaved=true（符合用户心智模型："修改了就要点保存"）
      // 注意：标题已经通过上面的 PATCH 单独保存到后端了，这里设置 markUnsaved=true
      //       只是让保存按钮亮起来，用户再点保存时会再PUT一次（无副作用）。
      updatePresentation({ title: newTitle }, true);
    } catch (err) {
      console.error('Failed to rename presentation in editor:', err);
      showToast(t('重命名失败，请重试'), 'error');
      // 失败：回滚输入框中的显示为原值
    }
  };
  const handlePresTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      finishEditingPresTitle();
    } else if (e.key === 'Escape') {
      setIsEditingPresTitle(false);
    }
  };
  return (
    <div className="flex flex-col h-full" ref={panelRef} tabIndex={0}>
      <div className="p-3 border-b border-slate-200 flex items-center justify-between gap-2">
        {isEditingPresTitle ? (
          <input
            ref={presTitleInputRef}
            type="text"
            value={editPresTitle}
            onChange={(e) => setEditPresTitle(e.target.value)}
            onBlur={finishEditingPresTitle}
            onKeyDown={handlePresTitleKeyDown}
            className="font-semibold text-slate-800 bg-slate-50 border border-blue-400 rounded-md px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-blue-200 w-full"
          />
        ) : (
          <button
            onClick={startEditingPresTitle}
            className="flex items-center gap-1.5 group flex-1 min-w-0 text-left"
            title={t('点击修改演示名称')}
          >
            <span className="font-semibold text-slate-800 text-sm truncate">
              {presentation?.title || t('未命名演示')}
            </span>
            <Pencil className="w-3.5 h-3.5 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
          </button>
        )}
        <button
          onClick={() => addSlide()}
          className="p-1 hover:bg-slate-100 rounded transition-colors shrink-0"
          title={t('新增幻灯片')}
        >
          <Plus className="w-4 h-4 text-slate-500" />
        </button>
      </div>

      <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">
          {t('幻灯片')}
          {selectedCount > 1 && (
            <span className="ml-2 text-blue-600 font-normal">
              {t('已选 {n} 张', { n: selectedCount })}
            </span>
          )}
        </span>
        <span className="text-xs text-slate-400">
          {t('{n} 张', { n: presentation?.slides.length || 0 })}
        </span>
      </div>

      <div
        className="flex-1 overflow-y-auto p-2 space-y-1"
        onContextMenu={handleBlankAreaContextMenu}
      >
        {presentation.slides.map((slide, index) => (
          <div
            key={slide.id}
            className={cn(
              'group relative rounded-lg overflow-hidden cursor-pointer border-2 transition-all',
              selectedSlideIds.has(slide.id)
                ? 'border-blue-500 shadow-sm bg-blue-50/30'
                : 'border-transparent hover:border-slate-300',
              draggedIds?.has(slide.id) && 'opacity-50',
              dragOverId === slide.id &&
                dragPosition === 'before' &&
                'border-t-2 border-t-blue-500',
              dragOverId === slide.id && dragPosition === 'after' && 'border-b-2 border-b-blue-500',
            )}
            onClick={(e) => handleSlideClick(e, slide.id, index)}
            onContextMenu={(e) => handleContextMenu(e, slide.id, index)}
            draggable={!editingId}
            onDragStart={(e) => handleDragStart(e, slide.id)}
            onDragOver={(e) => handleDragOver(e, slide.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, slide.id)}
            onDragEnd={handleDragEnd}
          >
            <div className="absolute left-1 top-1/2 -translate-y-1/2 z-10 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab">
              <GripVertical className="w-3 h-3 text-slate-400" />
            </div>

            <div className="absolute left-0 top-0 h-full w-5 bg-gradient-to-r from-black/5 to-transparent flex items-start justify-center pt-2">
              <span className="text-[10px] font-medium text-slate-500">{index + 1}</span>
            </div>

            <div
              ref={index === 0 ? thumbnailMeasureRef : null}
              className="ml-5 w-full overflow-hidden bg-white"
              style={{ aspectRatio: `${slideWidth} / ${slideHeight}` }}
            >
              <div
                className="origin-top-left bg-white relative"
                style={{
                  width: `${slideWidth}px`,
                  height: `${slideHeight}px`,
                  transform: `scale(${thumbnailScale})`,
                  transformOrigin: 'top left',
                }}
                dangerouslySetInnerHTML={safeHtml(slide.html)}
              />
            </div>

            <div className="absolute right-1 top-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  duplicateSlide(slide.id);
                }}
                className="p-1 bg-white/90 rounded hover:bg-slate-100"
                title={t('复制')}
              >
                <Copy className="w-3 h-3 text-slate-500" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (presentation.slides.length > 1) {
                    removeSlide(slide.id);
                  }
                }}
                className="p-1 bg-white/90 rounded hover:bg-red-50"
                title={t('删除')}
                disabled={presentation.slides.length <= 1}
              >
                <Trash2 className="w-3 h-3 text-red-500" />
              </button>
            </div>

            <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[10px] px-2 py-1 truncate">
              {editingId === slide.id ? (
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onBlur={handleSaveRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveRename();
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  className="w-full bg-white/20 border border-white/40 rounded px-1 py-0.5 text-white text-[10px] outline-none"
                />
              ) : (
                slide.title
              )}
            </div>
          </div>
        ))}
      </div>

      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-50 min-w-[140px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={handleOpenInNewTab}
            className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
          >
            <ExternalLink className="w-4 h-4" />
            {t('在新标签页打开')}
          </button>
          <div className="border-t border-slate-100 my-1" />
          <button
            onClick={handleCutClick}
            className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
          >
            <Scissors className="w-4 h-4" />
            {t('剪切')}
            <span className="ml-auto text-xs text-slate-400">Ctrl+X</span>
          </button>
          <button
            onClick={handleCopyClick}
            className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
          >
            <Copy className="w-4 h-4" />
            {t('复制')}
            <span className="ml-auto text-xs text-slate-400">Ctrl+C</span>
          </button>
          <button
            onClick={handlePasteClick}
            disabled={!canPasteSlide}
            className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Clipboard className="w-4 h-4" />
            {t('粘贴')}
            <span className="ml-auto text-xs text-slate-400">Ctrl+V</span>
          </button>
          <div className="border-t border-slate-100 my-1" />
          <button
            onClick={handleSetSingleBg}
            className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
          >
            <ImageIcon className="w-4 h-4" />
            {t('设置本页背景图')}
          </button>
          <button
            onClick={handleRemoveSingleBg}
            className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
          >
            <ImageOff className="w-4 h-4" />
            {t('移除本页背景图')}
          </button>
          <div className="border-t border-slate-100 my-1" />
          <button
            onClick={handleSetAllBg}
            className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
          >
            <ImageIcon className="w-4 h-4" />
            {t('一键设置所有背景图')}
          </button>
          <button
            onClick={handleRemoveAllBg}
            className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
          >
            <ImageOff className="w-4 h-4" />
            {t('一键移除所有背景图')}
          </button>
          <div className="border-t border-slate-100 my-1" />
          <button
            onClick={handleStartRename}
            className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
          >
            <Edit3 className="w-4 h-4" />
            {t('重命名')}
          </button>
          <button
            onClick={handleDelete}
            disabled={
              presentation.slides.length <= 1 || selectedSlideIds.size >= presentation.slides.length
            }
            className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Trash2 className="w-4 h-4" />
            {t('删除')}
            <span className="ml-auto text-xs text-red-300">Delete</span>
          </button>
        </div>
      )}

      {blankAreaContextMenu && (
        <div
          ref={blankMenuRef}
          className="fixed bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-50 min-w-[160px]"
          style={{ left: blankAreaContextMenu.x, top: blankAreaContextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => handlePasteSlides(presentation.slides.length)}
            disabled={!canPasteSlide}
            className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Clipboard className="w-4 h-4" />
            {canPasteSlide ? t('粘贴') : t('剪贴板为空')}
            <span className="ml-auto text-xs text-slate-400">Ctrl+V</span>
          </button>
          <div className="border-t border-slate-100 my-1" />
          <button
            onClick={handleSetAllBg}
            className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
          >
            <ImageIcon className="w-4 h-4" />
            {t('一键设置所有背景图')}
          </button>
          <button
            onClick={handleRemoveAllBg}
            className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
          >
            <ImageOff className="w-4 h-4" />
            {t('一键移除所有背景图')}
          </button>
          <button
            onClick={() => {
              addSlide();
              setBlankAreaContextMenu(null);
            }}
            className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            {t('新增幻灯片')}
          </button>
        </div>
      )}

      <input
        ref={bgInputRef}
        type="file"
        accept="image/*"
        onChange={handleBgFile}
        className="hidden"
      />
      <input
        ref={bgAllInputRef}
        type="file"
        accept="image/*"
        onChange={handleBgFile}
        className="hidden"
      />
    </div>
  );
}
