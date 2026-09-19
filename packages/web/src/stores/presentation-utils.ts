import type { Presentation } from '@noppt/core';
import { formatBeijingTime, sanitizeHtml } from '@/utils';
import { t } from '@/i18n';
import type { ChatMessage } from '@/utils/api';

export type HistoryEntry =
  { type: 'full'; presentation: Presentation } | { type: 'slide'; slideId: string; html: string };

/**
 * 安全清理演示文稿的所有 HTML 内容，防止 XSS
 */
function sanitizePresentationHtml(presentation: Presentation): Presentation {
  return {
    ...presentation,
    slides: presentation.slides.map((slide) => ({
      ...slide,
      html: sanitizeHtml(slide.html),
    })),
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
      content: t(
        '你好！我是你的 AI 演示助手。你可以告诉我怎么修改当前页面，或者对整个演示进行调整。想试试什么？',
      ),
      scope: 'current',
      timestamp: formatBeijingTime(),
    },
  ];
}

export { sanitizePresentationHtml, reconstructPresentation, getDefaultChatMessages };
