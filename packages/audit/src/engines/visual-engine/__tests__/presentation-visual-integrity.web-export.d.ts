import type { Deck } from '@noppt/core/deck';
import type { Presentation } from '@noppt/core';

declare module '@noppt/web/export/presentation-to-deck' {
  export function presentationToDeck(
    presentation: Presentation | null | undefined,
    options?: { allowHtmlFallback?: boolean; width?: number; height?: number },
  ): Deck;
}
