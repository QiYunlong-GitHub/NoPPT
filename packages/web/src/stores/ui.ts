import { create } from 'zustand';
import type { DraftPrefill } from '@/utils/api';

/**
 * 「AI 生成演示」配置页的预填载荷。
 *
 * 来源：Hermes 通过 MCP 工具 `noppt_prepare_outline_draft` 存草稿 →
 * 用户点开深链 → HomePage 拉取草稿后写入本状态 → AIGenerateModal 挂载时消费。
 */
export interface AIPrefillPayload {
  topic: string;
  referenceText?: string;
  /** 素材来源标识（如「企业知识库 / RAG」），仅用于展示 */
  referenceSource?: string;
  /** 素材长度硬上限（后端按页数分档给出） */
  referenceLimit?: number;
  referenceTruncated?: boolean;
  referenceOriginalChars?: number;
  style?: string;
  audience?: string;
  slideCount?: number;
  colorTheme?: string;
  fontFamily?: string;
  iconStyle?: string;
  mode?: 'auto' | 'guided';
}

/** 后端草稿视图 → 预填载荷。 */
export function prefillFromDraft(draft: DraftPrefill): AIPrefillPayload {
  return {
    topic: draft.topic,
    referenceText: draft.referenceText,
    referenceSource: draft.referenceSource,
    referenceLimit: draft.referenceLimit,
    referenceTruncated: draft.referenceTruncated,
    referenceOriginalChars: draft.referenceOriginalChars,
    style: draft.style,
    audience: draft.audience,
    slideCount: draft.slideCount,
    colorTheme: draft.colorTheme,
    fontFamily: draft.fontFamily,
    iconStyle: draft.iconStyle,
    mode: draft.mode,
  };
}

interface UIState {
  showAIGenerateModal: boolean;
  showExportModal: boolean;
  showSettingsModal: boolean;
  /** 待被配置弹窗消费的预填参数（消费后清空，避免下次打开残留）。 */
  aiPrefill: AIPrefillPayload | null;
  toast: {
    message: string;
    type: 'success' | 'error' | 'info' | 'warning';
    visible: boolean;
  } | null;

  /** 第二参可选：传入预填载荷时同步写入 `aiPrefill`（单参调用保持向后兼容）。 */
  setAIGenerateModal: (open: boolean, prefill?: AIPrefillPayload | null) => void;
  /** 仅写入预填（供深链在进入编辑器前暂存，随后由弹窗消费）。 */
  setAIPrefill: (prefill: AIPrefillPayload | null) => void;
  setExportModal: (open: boolean) => void;
  setSettingsModal: (open: boolean) => void;
  /** 取出并清空预填（一次性消费）。 */
  consumeAIPrefill: () => AIPrefillPayload | null;
  showToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
  hideToast: () => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  showAIGenerateModal: false,
  showExportModal: false,
  showSettingsModal: false,
  aiPrefill: null,
  toast: null,

  setAIGenerateModal: (open, prefill) =>
    set((state) => ({
      showAIGenerateModal: open,
      aiPrefill: prefill === undefined ? state.aiPrefill : prefill,
    })),
  setExportModal: (open) => set({ showExportModal: open }),
  setSettingsModal: (open) => set({ showSettingsModal: open }),
  setAIPrefill: (prefill) => set({ aiPrefill: prefill }),

  consumeAIPrefill: () => {
    const current = get().aiPrefill;
    if (current) set({ aiPrefill: null });
    return current;
  },

  showToast: (message, type = 'info') => {
    set({ toast: { message, type, visible: true } });
    setTimeout(() => {
      set((state) => ({
        toast: state.toast ? { ...state.toast, visible: false } : null,
      }));
    }, 3000);
  },

  hideToast: () => set({ toast: null }),
}));
