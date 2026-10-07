// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  escapeHtmlText,
  normalizeExportFilename,
  sanitizeExportSlideHtml,
  withTemporaryElement,
} from './export-security';

describe('export security helpers', () => {
  it('escapes HTML text and normalizes unsafe filenames', () => {
    expect(escapeHtmlText(`</title><script>alert('x')</script>`)).toBe(
      '&lt;/title&gt;&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;',
    );
    expect(normalizeExportFilename('Quarter:1/CON?.pptx')).toBe('Quarter_1_CON_.pptx');
    expect(normalizeExportFilename('...')).toBe('presentation');
  });

  it('sanitizes slide markup before an export sink', () => {
    const html = sanitizeExportSlideHtml(
      '<div><script>alert(1)</script><img src="javascript:1">ok</div>',
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('ok');
  });

  it('cleans temporary DOM nodes after an async failure', async () => {
    const element = document.createElement('div');
    await expect(
      withTemporaryElement(element, async () => {
        expect(document.body.contains(element)).toBe(true);
        throw new Error('render failed');
      }),
    ).rejects.toThrow('render failed');
    expect(document.body.contains(element)).toBe(false);
  });
});
