import type { Presentation } from '@noppt/core';
import { presentationApi, type ChatMessage } from '@/utils/api';
import { sanitizePresentationHtml, getDefaultChatMessages } from './presentation-utils';

export async function loadPresentationData(
  id: string,
  isCurrent: () => boolean,
): Promise<{ presentation: Presentation; messages: ChatMessage[] } | null> {
  const presentation = await presentationApi.get(id);
  if (!isCurrent()) return null;
  const sanitizedPresentation = sanitizePresentationHtml(presentation);
  let messages: ChatMessage[];
  try {
    messages = await presentationApi.getChatHistory(id);
    if (!messages || messages.length === 0) messages = getDefaultChatMessages();
  } catch {
    messages = getDefaultChatMessages();
  }
  if (!isCurrent()) return null;
  return { presentation: sanitizedPresentation, messages };
}
