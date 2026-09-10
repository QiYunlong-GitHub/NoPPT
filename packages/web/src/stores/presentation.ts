import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Presentation, Slide } from '@noppt/core';
import { LayoutEngine } from '@noppt/core';
import { presentationApi, type ChatMessage, type PresentationListItem } from '@/utils/api';
import { formatBeijingTime, sanitizeHtml } from '@/utils';
import { replaceIconsInHtml, type IconStyle } from '@/utils/iconReplacer';
import { t } from '@/i18n';

type HistoryEntry =
  | { type: 'full'; presentation: Presentation }
  | { type: 'slide'; slideId: string; html: string };

interface PresentationState {
  presentation: Presentation | null;
  presentations: PresentationListItem[];
  isLoading: boolean;
  error: string | null;
  chatMessages: ChatMessage[];
  currentChatPresentationId: string | null;
  hasUnsavedChanges: boolean;

  createPresentation: (title?: string, width?: number, height?: number) => Promise<Presentation>;
  loadPresentation: (id: string) => Promise<void>;
  savePresentation: () => Promise<boolean>;
  updatePresentation: (updates: Partial<Presentation>, markUnsaved?: boolean) => void;
  setPresentation: (presentation: Presentation, markUnsaved?: boolean, resetHistory?: boolean) => void;
  loadAllPresentations: () => Promise<void>;
  addPresentation: (presentation: Presentation) => void;
  deletePresentation: (id: string) => Promise<void>;
  clearAllPresentations: () => void;
  closeCurrentPresentation: () => void;
  resetChatMessages: () => Promise<void>;
  addChatMessage: (message: ChatMessage) => Promise<void>;
  markUnsaved: () => void;

  addSlide: (index?: number) => void;
  removeSlide: (slideId: string) => void;
  bulkRemoveSlides: (slideIds: string[]) => void;
  duplicateSlide: (slideId: string) => void;
  pasteSlide: (slideData: Slide, index?: number) => void;
  bulkPasteSlides: (slidesData: Slide[], index?: number) => void;
  moveSlide: (slideId: string, toIndex: number) => void;
  bulkMoveSlides: (slideIds: string[], toIndex: number) => void;
  selectSlide: (slideId: string) => void;
  updateSlide: (slideId: string, updates: Partial<Slide>, addToHistory?: boolean) => void;
  updateCurrentSlideHtml: (html: string) => void;

  setSlideBackground: (slideId: string, imageUrl: string, overlayOpacity?: number) => void;
  removeSlideBackground: (slideId: string) => void;
  setAllSlideBackgrounds: (imageUrl: string, overlayOpacity?: number) => void;
  removeAllSlideBackgrounds: () => void;
  applyIconStyle: (style: IconStyle) => void;

  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;

  setZoom: (zoom: number) => void;

  history: HistoryEntry[];
  historyIndex: number;
  saveHistory: () => void;
  saveSlideHistory: (slideId: string) => void;
}

const HISTORY_LIMIT = 100;

/**
 * 安全清理演示文稿的所有 HTML 内容，防止 XSS
 */
function sanitizePresentationHtml(presentation: Presentation): Presentation {
  return {
    ...presentation,
    slides: presentation.slides.map(slide => ({
      ...slide,
      html: sanitizeHtml(slide.html)
    }))
  };
}

function reconstructPresentation(history: HistoryEntry[], index: number): Presentation | null {
  let lastFullIndex = -1;
  for (let i = index; i >= 0; i--) {
    if (history[i].type === 'full') {
      lastFullIndex = i;
      break;
    }
  }

  if (lastFullIndex === -1) return null;

  const baseEntry = history[lastFullIndex];
  if (baseEntry.type !== 'full') return null;

  const result: Presentation = JSON.parse(JSON.stringify(baseEntry.presentation));

  for (let i = lastFullIndex + 1; i <= index; i++) {
    const entry = history[i];
    if (entry.type === 'slide') {
      const slide = result.slides.find((s) => s.id === entry.slideId);
      if (slide) {
        slide.html = entry.html;
      }
    }
  }

  return result;
}

function getDefaultChatMessages(): ChatMessage[] {
  return [
    {
      id: '1',
      role: 'assistant',
      content: t('你好！我是你的 AI 演示助手。你可以告诉我怎么修改当前页面，或者对整个演示进行调整。想试试什么？'),
      scope: 'current',
      timestamp: formatBeijingTime(),
    },
  ];
}

export const usePresentationStore = create<PresentationState>()(
  immer((set, get) => ({
    presentation: null,
    presentations: [],
    isLoading: false,
    error: null,
    canUndo: false,
    canRedo: false,
    history: [] as HistoryEntry[],
    historyIndex: -1,
    currentChatPresentationId: null,
    chatMessages: getDefaultChatMessages(),
    hasUnsavedChanges: false,

    markUnsaved: () => {
      set({ hasUnsavedChanges: true });
    },

    loadAllPresentations: async () => {
      const maxRetries = 8;
      const retryDelay = 1500;
      
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          const list = await presentationApi.list();
          set({ presentations: list, error: null });
          return;
        } catch (err) {
          if (attempt < maxRetries - 1) {
            await new Promise((resolve) => setTimeout(resolve, retryDelay));
          } else {
            console.error('Failed to load presentations after retries:', err);
            set({ error: t('加载演示列表失败') });
          }
        }
      }
    },

    createPresentation: async (title, width, height) => {
      const presentation = await presentationApi.create({ title, width, height });
      // 统一：normalizeAISlide（保证 slide.html 格式完全一致）
      const normalizedPresentation: Presentation = {
        ...presentation,
        slides: presentation.slides.map((slide) => LayoutEngine.normalizeAISlide(slide)),
      };
      // 安全清理所有 HTML 内容，防止 XSS（与 loadPresentation 保持同样的 sanitize 流程）
      const sanitizedPresentation = sanitizePresentationHtml(normalizedPresentation);
      const defaultMessages = getDefaultChatMessages();
      set((state) => {
        state.presentation = sanitizedPresentation;
        state.presentations = [
          {
            id: sanitizedPresentation.id,
            title: sanitizedPresentation.title,
            description: sanitizedPresentation.description,
            createdAt: sanitizedPresentation.createdAt,
            updatedAt: sanitizedPresentation.updatedAt,
            slideCount: sanitizedPresentation.slides.length,
          },
          ...state.presentations,
        ];
        state.history = [{ type: 'full', presentation: sanitizedPresentation }];
        state.historyIndex = 0;
        state.canUndo = false;
        state.canRedo = false;
        state.hasUnsavedChanges = false;
        state.currentChatPresentationId = sanitizedPresentation.id;
        state.chatMessages = defaultMessages;
      });
      return sanitizedPresentation;
    },

    loadPresentation: async (id) => {
      try {
        const presentation = await presentationApi.get(id);
        // 安全清理演示文稿的所有 HTML 内容
        const sanitizedPresentation = sanitizePresentationHtml(presentation);
        let messages: ChatMessage[];
        try {
          messages = await presentationApi.getChatHistory(id);
          if (!messages || messages.length === 0) {
            messages = getDefaultChatMessages();
          }
        } catch {
          messages = getDefaultChatMessages();
        }
        set({
          presentation: sanitizedPresentation,
          history: [{ type: 'full', presentation: sanitizedPresentation }],
          historyIndex: 0,
          canUndo: false,
          canRedo: false,
          currentChatPresentationId: id,
          chatMessages: messages,
          hasUnsavedChanges: false,
        });
      } catch (err) {
        console.error('Failed to load presentation:', err);
        set({ error: t('演示文稿不存在') });
      }
    },

    savePresentation: async (): Promise<boolean> => {
      const { presentation } = get();
      if (presentation) {
        const updated = { ...presentation, updatedAt: Date.now() };
        try {
          const saved = await presentationApi.save(updated.id, updated);
          set((state) => {
            state.presentation = saved;
            state.hasUnsavedChanges = false;
            const idx = state.presentations.findIndex((p) => p.id === saved.id);
            if (idx !== -1) {
              state.presentations[idx] = {
                id: saved.id,
                title: saved.title,
                description: saved.description,
                createdAt: saved.createdAt,
                updatedAt: saved.updatedAt,
                slideCount: saved.slides.length,
              };
            }
          });
          return true;
        } catch (err) {
          console.error('Failed to save presentation:', err);
          return false;
        }
      }
      // 没有当前演示，不算失败（没有需要保存的内容）
      return true;
    },

    updatePresentation: (updates, markUnsaved = true) => {
      set((state) => {
        if (state.presentation) {
          state.presentation = {
            ...state.presentation,
            ...updates,
            updatedAt: Date.now(),
          };
          if (markUnsaved) {
            state.hasUnsavedChanges = true;
          }
          const idx = state.presentations.findIndex(
            (p) => p.id === state.presentation!.id,
          );
          if (idx !== -1) {
            state.presentations[idx] = {
              ...state.presentations[idx],
              title: state.presentation.title,
              updatedAt: state.presentation.updatedAt,
            };
          }
        }
      });
    },

    setPresentation: (presentation, markUnsaved = true, resetHistory = false) => {
      const sanitizedPresentation = sanitizePresentationHtml(presentation);
      set((state) => {
        state.presentation = sanitizedPresentation;
        if (markUnsaved) {
          state.hasUnsavedChanges = true;
        }
        if (resetHistory) {
          state.history = [{ type: 'full', presentation: sanitizedPresentation }];
          state.historyIndex = 0;
          state.canUndo = false;
          state.canRedo = false;
        }
        const idx = state.presentations.findIndex(
          (p) => p.id === sanitizedPresentation.id,
        );
        if (idx !== -1) {
          state.presentations[idx] = {
            ...state.presentations[idx],
            title: sanitizedPresentation.title,
            updatedAt: sanitizedPresentation.updatedAt,
          };
        }
      });
    },

    addPresentation: (presentation) => {
      set((state) => {
        const existing = state.presentations.findIndex((p) => p.id === presentation.id);
        const item = {
          id: presentation.id,
          title: presentation.title,
          description: presentation.description,
          createdAt: presentation.createdAt,
          updatedAt: presentation.updatedAt,
          slideCount: presentation.slides.length,
        };
        if (existing !== -1) {
          state.presentations[existing] = item;
        } else {
          state.presentations.unshift(item);
        }
      });
    },

    deletePresentation: async (id) => {
      try {
        await presentationApi.remove(id);
        set((state) => {
          state.presentations = state.presentations.filter((p) => p.id !== id);
          if (state.presentation?.id === id) {
            state.presentation = null;
          }
        });
      } catch (err) {
        console.error('Failed to delete presentation:', err);
      }
    },

    clearAllPresentations: async () => {
      try {
        await presentationApi.clearAll();
      } catch (err) {
        console.error('Failed to clear presentations on server:', err);
      }
      set({
        presentations: [],
        presentation: null,
        history: [],
        historyIndex: -1,
        canUndo: false,
        canRedo: false,
        chatMessages: getDefaultChatMessages(),
        currentChatPresentationId: null,
      });
    },

    closeCurrentPresentation: () => {
      set({
        presentation: null,
        history: [],
        historyIndex: -1,
        canUndo: false,
        canRedo: false,
        hasUnsavedChanges: false,
        currentChatPresentationId: null,
        chatMessages: getDefaultChatMessages(),
      });
    },

    saveHistory: () => {
      const { presentation, history, historyIndex } = get();
      if (!presentation) return;

      const entry: HistoryEntry = {
        type: 'full',
        presentation: JSON.parse(JSON.stringify(presentation)),
      };
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(entry);

      if (newHistory.length > HISTORY_LIMIT) {
        newHistory.shift();
      }

      const newIndex = newHistory.length - 1;
      set({
        history: newHistory,
        historyIndex: newIndex,
        canUndo: newIndex > 0,
        canRedo: false,
      });
    },

    saveSlideHistory: (slideId: string) => {
      const { presentation, history, historyIndex } = get();
      if (!presentation) return;

      const slide = presentation.slides.find((s) => s.id === slideId);
      if (!slide) return;

      const entry: HistoryEntry = {
        type: 'slide',
        slideId,
        html: slide.html,
      };
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(entry);

      if (newHistory.length > HISTORY_LIMIT) {
        newHistory.shift();
      }

      const newIndex = newHistory.length - 1;
      set({
        history: newHistory,
        historyIndex: newIndex,
        canUndo: newIndex > 0,
        canRedo: false,
      });
    },

    addSlide: (index) => {
      const { presentation, saveHistory } = get();
      if (!presentation) return;

      const slideIndex = index ?? presentation.slides.length;
      const rawNewSlide = LayoutEngine.createSlide(slideIndex);
      const newSlide: Slide = LayoutEngine.normalizeAISlide(rawNewSlide);

      const updatedSlides = [
        ...presentation.slides.slice(0, slideIndex),
        newSlide,
        ...presentation.slides.slice(slideIndex).map((s) => ({
          ...s,
          index: s.index + 1,
        })),
      ];

      set((state) => {
        if (state.presentation) {
          state.presentation.slides = updatedSlides;
          state.presentation.selectedSlideId = newSlide.id;
          state.presentation.updatedAt = Date.now();
          state.hasUnsavedChanges = true;
        }
      });

      saveHistory();
    },

    removeSlide: (slideId) => {
      const { presentation, saveHistory } = get();
      if (!presentation || presentation.slides.length <= 1) return;

      const idx = presentation.slides.findIndex((s) => s.id === slideId);
      if (idx === -1) return;

      const updatedSlides = presentation.slides
        .filter((s) => s.id !== slideId)
        .map((s, i) => ({ ...s, index: i }));

      const nextSelected = updatedSlides[Math.min(idx, updatedSlides.length - 1)];

      set((state) => {
        if (state.presentation) {
          state.presentation.slides = updatedSlides;
          state.presentation.selectedSlideId = nextSelected?.id;
          state.presentation.updatedAt = Date.now();
          state.hasUnsavedChanges = true;
        }
      });

      saveHistory();
    },

    bulkRemoveSlides: (slideIds) => {
      const { presentation, saveHistory } = get();
      if (!presentation || slideIds.length === 0) return;
      if (slideIds.length >= presentation.slides.length) return;

      const idSet = new Set(slideIds);
      const updatedSlides = presentation.slides
        .filter((s) => !idSet.has(s.id))
        .map((s, i) => ({ ...s, index: i }));

      const firstRemovedIdx = presentation.slides.findIndex((s) => idSet.has(s.id));
      const nextSelected = updatedSlides[Math.min(firstRemovedIdx, updatedSlides.length - 1)];

      set((state) => {
        if (state.presentation) {
          state.presentation.slides = updatedSlides;
          state.presentation.selectedSlideId = nextSelected?.id;
          state.presentation.updatedAt = Date.now();
          state.hasUnsavedChanges = true;
        }
      });

      saveHistory();
    },

    duplicateSlide: (slideId) => {
      const { presentation, saveHistory } = get();
      if (!presentation) return;

      const idx = presentation.slides.findIndex((s) => s.id === slideId);
      if (idx === -1) return;

      const original = presentation.slides[idx];
      const duplicated = LayoutEngine.duplicateSlide(original, idx + 1);

      const updatedSlides = [
        ...presentation.slides.slice(0, idx + 1),
        duplicated,
        ...presentation.slides.slice(idx + 1).map((s) => ({
          ...s,
          index: s.index + 1,
        })),
      ];

      set((state) => {
        if (state.presentation) {
          state.presentation.slides = updatedSlides;
          state.presentation.selectedSlideId = duplicated.id;
          state.presentation.updatedAt = Date.now();
          state.hasUnsavedChanges = true;
        }
      });

      saveHistory();
    },

    pasteSlide: (slideData, index) => {
      const { presentation, saveHistory } = get();
      if (!presentation) return;

      const slideIndex = index ?? presentation.slides.length;
      const newSlide = {
        ...slideData,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        index: slideIndex,
      };

      const updatedSlides = [
        ...presentation.slides.slice(0, slideIndex),
        newSlide,
        ...presentation.slides.slice(slideIndex).map((s) => ({
          ...s,
          index: s.index + 1,
        })),
      ];

      set((state) => {
        if (state.presentation) {
          state.presentation.slides = updatedSlides;
          state.presentation.selectedSlideId = newSlide.id;
          state.presentation.updatedAt = Date.now();
          state.hasUnsavedChanges = true;
        }
      });

      saveHistory();
    },

    bulkPasteSlides: (slidesData, index) => {
      const { presentation, saveHistory } = get();
      if (!presentation || slidesData.length === 0) return;

      const slideIndex = index ?? presentation.slides.length;
      const now = Date.now();
      const newSlides = slidesData.map((slideData, i) => ({
        ...slideData,
        id: `${now}-${Math.random().toString(36).slice(2, 9)}-${i}`,
        index: slideIndex + i,
      }));

      const updatedSlides = [
        ...presentation.slides.slice(0, slideIndex),
        ...newSlides,
        ...presentation.slides.slice(slideIndex).map((s) => ({
          ...s,
          index: s.index + newSlides.length,
        })),
      ];

      set((state) => {
        if (state.presentation) {
          state.presentation.slides = updatedSlides;
          state.presentation.selectedSlideId = newSlides[0]?.id;
          state.presentation.updatedAt = Date.now();
          state.hasUnsavedChanges = true;
        }
      });

      saveHistory();
    },

    moveSlide: (slideId, toIndex) => {
      const { presentation, saveHistory } = get();
      if (!presentation) return;

      const fromIndex = presentation.slides.findIndex((s) => s.id === slideId);
      if (fromIndex === -1 || fromIndex === toIndex) return;

      const slides = [...presentation.slides];
      const [moved] = slides.splice(fromIndex, 1);
      slides.splice(toIndex, 0, moved);

      const updatedSlides = slides.map((s, i) => ({ ...s, index: i }));

      set((state) => {
        if (state.presentation) {
          state.presentation.slides = updatedSlides;
          state.presentation.updatedAt = Date.now();
          state.hasUnsavedChanges = true;
        }
      });

      saveHistory();
    },

    bulkMoveSlides: (slideIds, toIndex) => {
      const { presentation, saveHistory } = get();
      if (!presentation || slideIds.length === 0) return;

      const idSet = new Set(slideIds);
      const slides = [...presentation.slides];
      const movedSlides: Slide[] = [];
      const remaining: Slide[] = [];

      for (const slide of slides) {
        if (idSet.has(slide.id)) {
          movedSlides.push(slide);
        } else {
          remaining.push(slide);
        }
      }

      if (movedSlides.length === 0) return;

      const insertIndex = Math.min(Math.max(toIndex, 0), remaining.length);
      const newSlides = [
        ...remaining.slice(0, insertIndex),
        ...movedSlides,
        ...remaining.slice(insertIndex),
      ];

      const updatedSlides = newSlides.map((s, i) => ({ ...s, index: i }));

      set((state) => {
        if (state.presentation) {
          state.presentation.slides = updatedSlides;
          state.presentation.selectedSlideId = movedSlides[0]?.id;
          state.presentation.updatedAt = Date.now();
          state.hasUnsavedChanges = true;
        }
      });

      saveHistory();
    },

    selectSlide: (slideId) => {
      set((state) => {
        if (state.presentation) {
          state.presentation.selectedSlideId = slideId;
        }
      });
    },

    updateSlide: (slideId, updates, addToHistory = true) => {
      const { presentation, saveHistory, saveSlideHistory } = get();
      if (!presentation) return;

      const isHtmlOnly = Object.keys(updates).length === 1 && 'html' in updates;

      set((state) => {
        if (state.presentation) {
          const slide = state.presentation.slides.find((s) => s.id === slideId);
          if (slide) {
            Object.assign(slide, updates);
            state.presentation.updatedAt = Date.now();
            state.hasUnsavedChanges = true;
          }
        }
      });

      if (addToHistory) {
        if (isHtmlOnly) {
          saveSlideHistory(slideId);
        } else {
          saveHistory();
        }
      }
    },

    updateCurrentSlideHtml: (html) => {
      const { presentation, saveSlideHistory } = get();
      if (!presentation || !presentation.selectedSlideId) return;

      const sanitizedHtml = sanitizeHtml(html);
      const slideId = presentation.selectedSlideId;

      set((state) => {
        if (state.presentation) {
          const slide = state.presentation.slides.find(
            (s) => s.id === state.presentation!.selectedSlideId,
          );
          if (slide) {
            slide.html = sanitizedHtml;
            state.presentation.updatedAt = Date.now();
            state.hasUnsavedChanges = true;
          }
        }
      });

      saveSlideHistory(slideId);
    },

    setSlideBackground: (slideId, imageUrl, overlayOpacity = 0.88) => {
      const { presentation, saveSlideHistory } = get();
      if (!presentation) return;

      set((state) => {
        if (state.presentation) {
          const slide = state.presentation.slides.find((s) => s.id === slideId);
          if (slide) {
            slide.html = slide.html.replace(/^(<div\b[^>]*>)/i, (openTag) => {
              const styleMatch = openTag.match(/style="([^"]*)"/i);
              let style = styleMatch ? styleMatch[1] : '';
              style = style
                .replace(/background-image:\s*[^;]+;?/gi, '')
                .replace(/background-size:\s*[^;]+;?/gi, '')
                .replace(/background-position:\s*[^;]+;?/gi, '')
                .replace(/background-repeat:\s*[^;]+;?/gi, '')
                .replace(/background-color:\s*[^;]+;?/gi, '')
                .replace(/background:\s*[^;]+;?/gi, '');
              const bgStyle = `background-image:linear-gradient(rgba(255,255,255,${overlayOpacity}),rgba(255,255,255,${overlayOpacity})),url('${imageUrl}');background-size:cover;background-position:center;background-repeat:no-repeat;background-color:transparent;`;
              const newStyle = bgStyle + style;
              if (styleMatch) {
                return openTag.replace(/style="[^"]*"/i, `style="${newStyle}"`);
              }
              return openTag.replace(/^<div\b/i, `<div style="${newStyle}"`);
            });
            state.presentation.updatedAt = Date.now();
            state.hasUnsavedChanges = true;
          }
        }
      });
      saveSlideHistory(slideId);
    },

    removeSlideBackground: (slideId) => {
      const { presentation, saveSlideHistory } = get();
      if (!presentation) return;

      set((state) => {
        if (state.presentation) {
          const slide = state.presentation.slides.find((s) => s.id === slideId);
          if (slide) {
            slide.html = slide.html
              .replace(/background-image:\s*[^;]+;?/gi, '')
              .replace(/background-size:\s*cover[^;]*;?/gi, '')
              .replace(/background-position:\s*center[^;]*;?/gi, '')
              .replace(/background-repeat:\s*no-repeat[^;]*;?/gi, '')
              .replace(/background-color:\s*transparent[^;]*;?/gi, 'background-color:#fff;');
            state.presentation.updatedAt = Date.now();
            state.hasUnsavedChanges = true;
          }
        }
      });
      saveSlideHistory(slideId);
    },

    setAllSlideBackgrounds: (imageUrl, overlayOpacity = 0.88) => {
      const { presentation, saveHistory } = get();
      if (!presentation) return;

      set((state) => {
        if (state.presentation) {
          for (const slide of state.presentation.slides) {
            slide.html = slide.html.replace(/^(<div\b[^>]*>)/i, (openTag) => {
              const styleMatch = openTag.match(/style="([^"]*)"/i);
              let style = styleMatch ? styleMatch[1] : '';
              style = style
                .replace(/background-image:\s*[^;]+;?/gi, '')
                .replace(/background-size:\s*[^;]+;?/gi, '')
                .replace(/background-position:\s*[^;]+;?/gi, '')
                .replace(/background-repeat:\s*[^;]+;?/gi, '')
                .replace(/background-color:\s*[^;]+;?/gi, '')
                .replace(/background:\s*[^;]+;?/gi, '');
              const bgStyle = `background-image:linear-gradient(rgba(255,255,255,${overlayOpacity}),rgba(255,255,255,${overlayOpacity})),url('${imageUrl}');background-size:cover;background-position:center;background-repeat:no-repeat;background-color:transparent;`;
              const newStyle = bgStyle + style;
              if (styleMatch) {
                return openTag.replace(/style="[^"]*"/i, `style="${newStyle}"`);
              }
              return openTag.replace(/^<div\b/i, `<div style="${newStyle}"`);
            });
          }
          state.presentation.updatedAt = Date.now();
          state.hasUnsavedChanges = true;
        }
      });
      saveHistory();
    },

    removeAllSlideBackgrounds: () => {
      const { presentation, saveHistory } = get();
      if (!presentation) return;

      set((state) => {
        if (state.presentation) {
          for (const slide of state.presentation.slides) {
            slide.html = slide.html
              .replace(/background-image:\s*[^;]+;?/gi, '')
              .replace(/background-size:\s*cover[^;]*;?/gi, '')
              .replace(/background-position:\s*center[^;]*;?/gi, '')
              .replace(/background-repeat:\s*no-repeat[^;]*;?/gi, '')
              .replace(/background-color:\s*transparent[^;]*;?/gi, 'background-color:#fff;');
          }
          state.presentation.updatedAt = Date.now();
          state.hasUnsavedChanges = true;
        }
      });
      saveHistory();
    },

    applyIconStyle: (style: IconStyle) => {
      const { presentation, saveHistory } = get();
      if (!presentation) return;

      saveHistory();

      set((state) => {
        if (state.presentation) {
          for (const slide of state.presentation.slides) {
            slide.html = sanitizeHtml(replaceIconsInHtml(slide.html, style));
          }
          state.presentation.updatedAt = Date.now();
          state.hasUnsavedChanges = true;
        }
      });
    },

    undo: () => {
      const { history, historyIndex, presentation } = get();
      if (historyIndex <= 0) return;

      const newIndex = historyIndex - 1;
      const snapshot = reconstructPresentation(history, newIndex);
      if (!snapshot) return;

      const currentSelectedSlideId = presentation?.selectedSlideId;
      const slideExists = currentSelectedSlideId
        && snapshot.slides.some((s) => s.id === currentSelectedSlideId);
      const targetSelectedSlideId = slideExists
        ? currentSelectedSlideId
        : snapshot.slides[snapshot.slides.length - 1]?.id;

      set({
        presentation: {
          ...snapshot,
          selectedSlideId: targetSelectedSlideId,
        },
        historyIndex: newIndex,
        canUndo: newIndex > 0,
        canRedo: true,
        hasUnsavedChanges: true,
      });
    },

    redo: () => {
      const { history, historyIndex, presentation } = get();
      if (historyIndex >= history.length - 1) return;

      const newIndex = historyIndex + 1;
      const snapshot = reconstructPresentation(history, newIndex);
      if (!snapshot) return;

      const currentSelectedSlideId = presentation?.selectedSlideId;
      const slideExists = currentSelectedSlideId
        && snapshot.slides.some((s) => s.id === currentSelectedSlideId);
      const targetSelectedSlideId = slideExists
        ? currentSelectedSlideId
        : snapshot.slides[snapshot.slides.length - 1]?.id;

      set({
        presentation: {
          ...snapshot,
          selectedSlideId: targetSelectedSlideId,
        },
        historyIndex: newIndex,
        canUndo: true,
        canRedo: newIndex < history.length - 1,
        hasUnsavedChanges: true,
      });
    },

    setZoom: (zoom) => {
      set((state) => {
        if (state.presentation) {
          state.presentation.zoom = Math.max(0.25, Math.min(4, zoom));
        }
      });
    },

    resetChatMessages: async () => {
      const { presentation } = get();
      const defaultMessages = getDefaultChatMessages();
      if (presentation) {
        try {
          await presentationApi.saveChatHistory(presentation.id, defaultMessages);
        } catch (err) {
          console.error('Failed to reset chat history:', err);
        }
      }
      set({
        chatMessages: defaultMessages,
      });
    },

    addChatMessage: async (message) => {
      const { presentation } = get();
      set((state) => {
        state.chatMessages.push(message);
      });
      if (presentation) {
        try {
          await new Promise((resolve) => setTimeout(resolve, 0));
          const { chatMessages: latestMessages } = get();
          await presentationApi.saveChatHistory(presentation.id, latestMessages);
        } catch (err) {
          console.error('Failed to save chat message:', err);
        }
      }
    },
  })),
);
