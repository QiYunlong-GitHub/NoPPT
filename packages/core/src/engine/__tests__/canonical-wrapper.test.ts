import { describe, expect, it } from 'vitest';
import { LayoutEngine } from '../layout-engine';
import type { Slide } from '../../models/slide';

const CANONICAL =
  '<div style="position:relative;width:1280px;height:720px;width:var(--noppt-root-width,100vw);' +
  'height:min(720px,calc(100vw * 720 / 1280));max-width:1280px;box-sizing:border-box;overflow:visible" ' +
  'data-canonical-root="true" data-logical-width="1280" data-logical-height="720">' +
  '<div data-logical-canvas="true" style="position:relative;width:1280px;height:720px;overflow:visible">' +
  '<div style="position:absolute;left:64px;top:112px;width:1152px;height:48px">' +
  '<h2 style="font-size:40px;overflow-wrap:anywhere;word-break:break-word;">判定厄尔尼诺看4个关键阈值</h2>' +
  '</div></div></div>';

const PADDED_WRAPPER =
  '<div style="width: 100%; height: 100%; overflow: hidden; position: relative; box-sizing: border-box; ' +
  'padding: 48px 64px; background-color: #fff; display: flex; flex-direction: column; ' +
  'font-family: system-ui,-apple-system,\'Segoe UI\',Roboto,\'Helvetica Neue\',Arial,sans-serif">';

const mkSlide = (html: string): Slide => ({ id: 's1', index: 0, html } as Slide);

describe('canonical Deck 外层 wrapper 防护（LayoutEngine.normalizeAISlide）', () => {
  it('canonical root 不被再包一层 padding wrapper', () => {
    const out = LayoutEngine.normalizeAISlide(mkSlide(CANONICAL)).html;
    expect(out).not.toContain(PADDED_WRAPPER);
    expect(out).toContain('data-canonical-root="true"');
    expect(out.startsWith('<div')).toBe(true);
    expect(out).toMatch(/data-canonical-root="true"[\s\S]*data-logical-canvas="true"/);
  });

  it('历史产物已被误包的 padding wrapper 会被剥离', () => {
    const legacy = `${PADDED_WRAPPER}${CANONICAL}</div>`;
    const out = LayoutEngine.normalizeAISlide(mkSlide(legacy)).html;
    expect(out).not.toContain(PADDED_WRAPPER);
    expect(out).not.toContain('padding: 48px 64px');
    expect(out).toContain('data-canonical-root="true"');
    expect((out.match(/data-canonical-root="true"/g) ?? []).length).toBe(1);
  });

  it('非 canonical 的普通 HTML 仍补外层容器（向后兼容）', () => {
    const out = LayoutEngine.normalizeAISlide(mkSlide('<h2>标题</h2><ul><li>a</li></ul>')).html;
    expect(out).toMatch(/width\s*:\s*100%/);
    expect(out).toContain('标题');
  });
});
