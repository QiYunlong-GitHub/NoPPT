import { sanitizeHtml } from './security';

/** Escape text inserted into an HTML document context. */
export function escapeHtmlText(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Return a filesystem-safe filename stem while preserving a useful fallback. */
export function normalizeExportFilename(value: unknown, fallback = 'presentation'): string {
  const normalized = String(value ?? '')
    .split('')
    .map((char) => (char.charCodeAt(0) < 32 ? '_' : char))
    .join('')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 180);
  const safe = normalized || fallback;
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(safe) ? `_${safe}` : safe;
}

/** Sanitize HTML immediately before it enters an export DOM or serialized sink. */
export function sanitizeExportSlideHtml(html: unknown): string {
  return sanitizeHtml(typeof html === 'string' ? html : '');
}

/** Ensure temporary export DOM nodes are removed on success and failure. */
export async function withTemporaryElement<T>(
  element: HTMLElement,
  callback: (element: HTMLElement) => Promise<T> | T,
): Promise<T> {
  document.body.appendChild(element);
  try {
    return await callback(element);
  } finally {
    element.remove();
  }
}
