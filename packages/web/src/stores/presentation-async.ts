import type { Presentation } from '@noppt/core';
import { presentationApi, type ChatMessage } from '@/utils/api';
import { sanitizePresentationHtml, getDefaultChatMessages } from './presentation-utils';

export interface LoadedPresentationData {
  presentation: Presentation;
  /**
   * 聊天历史改为非阻塞：画布数据就绪即可返回，消息后续补入。
   * 调用方必须用 loadSequence / currentChatPresentationId 校验后再写入 store，
   * 避免切页后旧请求覆盖新状态。
   */
  messages: Promise<ChatMessage[]>;
}

export async function loadPresentationData(
  id: string,
  isCurrent: () => boolean,
): Promise<LoadedPresentationData | null> {
  const presentation = await presentationApi.get(id);
  if (!isCurrent()) return null;
  const sanitizedPresentation = sanitizePresentationHtml(presentation);
  const messages = (async (): Promise<ChatMessage[]> => {
    try {
      const history = await presentationApi.getChatHistory(id);
      return history && history.length > 0 ? history : getDefaultChatMessages();
    } catch {
      return getDefaultChatMessages();
    }
  })();
  return { presentation: sanitizedPresentation, messages };
}
