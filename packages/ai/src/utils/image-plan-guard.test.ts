import { describe, it, expect } from 'vitest';
import {
  isStructurePage,
  resolveSlideImageDecision,
  stripImagePlaceholders,
  IMAGE_PLACEHOLDER_SRC,
} from './image-plan-guard';

describe('image-plan-guard · 配图决策单一真源', () => {
  it('isStructurePage 只认 cover / toc / summary', () => {
    expect(isStructurePage('cover')).toBe(true);
    expect(isStructurePage('toc')).toBe(true);
    expect(isStructurePage('summary')).toBe(true);
    expect(isStructurePage('content-image-left')).toBe(false);
    expect(isStructurePage('content-no-image')).toBe(false);
    expect(isStructurePage(undefined)).toBe(false);
    expect(isStructurePage(null)).toBe(false);
  });

  it('结构页在任何偏好下都不配图，且必须剥离占位符', () => {
    for (const pageType of ['cover', 'toc', 'summary']) {
      for (const imagePreference of ['all', 'content-only', 'minimal', 'none'] as const) {
        const d = resolveSlideImageDecision({
          pageType,
          planNeedsImage: true,
          imagePreference,
          imageEnabled: true,
        });
        expect(d.needsImage).toBe(false);
        expect(d.stripPlaceholder).toBe(true);
        expect(d.reason).toBe('structure-page');
      }
    }
  });

  it('图片开关关闭 / pref=none 时不配图并剥离占位符', () => {
    expect(
      resolveSlideImageDecision({
        pageType: 'content-image-left',
        planNeedsImage: true,
        imagePreference: 'content-only',
        imageEnabled: false,
      }),
    ).toMatchObject({ needsImage: false, stripPlaceholder: true, reason: 'image-disabled' });

    expect(
      resolveSlideImageDecision({
        pageType: 'content-image-left',
        planNeedsImage: true,
        imagePreference: 'none',
        imageEnabled: true,
      }),
    ).toMatchObject({ needsImage: false, stripPlaceholder: true, reason: 'pref-none' });
  });

  it('内容页维持既有行为（plan.needsImage 或已有占位符 → 配图，不剥离）', () => {
    expect(
      resolveSlideImageDecision({
        pageType: 'content-image-left',
        planNeedsImage: true,
        imagePreference: 'content-only',
        imageEnabled: true,
      }),
    ).toMatchObject({ needsImage: true, stripPlaceholder: false, reason: 'plan-needs-image' });

    expect(
      resolveSlideImageDecision({
        pageType: 'content-value-showcase',
        planNeedsImage: false,
        imagePreference: 'content-only',
        imageEnabled: true,
        hasPlaceholder: true,
      }),
    ).toMatchObject({ needsImage: true, stripPlaceholder: false, reason: 'content-placeholder' });

    expect(
      resolveSlideImageDecision({
        pageType: 'content-compare',
        planNeedsImage: false,
        imagePreference: 'content-only',
        imageEnabled: true,
      }),
    ).toMatchObject({ needsImage: false, stripPlaceholder: false, reason: 'content-no-image' });
  });
});

describe('image-plan-guard · stripImagePlaceholders', () => {
  const ph = IMAGE_PLACEHOLDER_SRC;

  it('无占位符时原样返回（幂等）', () => {
    const html = '<div><p>纯文字</p></div>';
    expect(stripImagePlaceholders(html)).toBe(html);
    expect(stripImagePlaceholders(stripImagePlaceholders(html))).toBe(html);
  });

  it('移除占位 img，保留真实 img 与装饰色块', () => {
    const html =
      `<div>` +
      `<div style="width:40px;height:40px;border-radius:50%;background:#06D6A0;position:absolute"></div>` +
      `<img src="${ph}" data-image-ratio="4:3" alt="示意图">` +
      `<img src="/data/workspace/x/real.png" alt="真实图">` +
      `</div>`;
    const out = stripImagePlaceholders(html);
    expect(out).not.toContain('NOPPT_IMAGE_PLACEHOLDER');
    expect(out).toContain('/data/workspace/x/real.png');
    expect(out).toContain('#06D6A0');
    // 幂等
    expect(stripImagePlaceholders(out)).toBe(out);
  });

  it('清理变空的图片外壳，且不影响装饰性空 div', () => {
    const html =
      `<div style="display:flex;gap:40px">` +
      `<div style="flex:0 0 48%;min-width:0;display:flex;align-items:center;justify-content:center;overflow:hidden;border-radius:16px">` +
      `<img src="${ph}" data-image-ratio="4:3"></div>` +
      `<div style="flex:0 0 52%;display:flex;flex-direction:column"></div>` +
      `</div>`;
    const out = stripImagePlaceholders(html);
    expect(out).not.toContain('flex:0 0 48%'); // 空图片外壳已移除
    expect(out).toContain('flex:0 0 52%');
  });

  it('collapseLayout 把残留的固定宽度分栏收敛为 flex:1', () => {
    const html =
      `<div style="display:flex;gap:40px">` +
      `<div style="flex:0 0 52%;display:flex;flex-direction:column"><h1>标题</h1></div>` +
      `<div style="flex:0 0 48%;overflow:hidden;border-radius:16px"><img src="${ph}"></div>` +
      `</div>`;
    const out = stripImagePlaceholders(html, { collapseLayout: true });
    expect(out).not.toContain('flex:0 0 48%');
    expect(out).toContain('flex:1');
    expect(out).toContain('<h1>标题</h1>');
  });
});
