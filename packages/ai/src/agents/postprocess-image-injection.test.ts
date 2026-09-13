import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { HTMLPresentationAgent } from './html-presentation-agent';
import {
  IMAGE_PLACEHOLDER_SRC,
  resolveSlideImageDecision,
  stripImagePlaceholders,
} from '../utils/image-plan-guard';

/**
 * 回归样本：pres_mtzke4lj_ovu6r61 / slide-02 的 LLM 原始响应片段
 * （纯文字内容页：h2 + 4 个绝对定位几何装饰 + 4 项 ul + 内联 SVG，无 img）
 */
const FIXTURE = readFileSync(
  resolve(__dirname, '__fixtures__/pres_mtzke4lj-slide02.html'),
  'utf8',
);

/** 只借用原型方法，避免构造 LLM provider */
function makeAgent(): any {
  return Object.create(HTMLPresentationAgent.prototype);
}

function visibleText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, '');
}

function parseRoot(html: string): { doc: Document; root: HTMLElement } {
  const dom = new JSDOM(`<!doctype html><body><div id="__t">${html}</div></body>`);
  const doc = dom.window.document;
  return { doc, root: doc.getElementById('__t') as HTMLElement };
}

describe('后处理图片注入 · DOM 级最小侵入（pres_mtzke4lj 回归）', () => {
  const KEY_POINTS = [
    '定义：赤道中东太平洋海表温度持续异常偏高',
    '成因：信风减弱，暖水东流，改变大气环流',
    '周期：平均每2-7年发生一次，持续9-12个月',
    '命名：西班牙语',
  ];

  it('注入后：装饰与 h2 保留、要点文字一个字不丢、仅 1 张占位图', () => {
    const out = makeAgent().injectImagePlaceholderForContentSlide(
      FIXTURE,
      'content-image-left',
      '#e94560',
    );
    expect(out).not.toBe(FIXTURE);
    // 只注入 1 处占位符
    expect((out.match(/NOPPT_IMAGE_PLACEHOLDER/g) || []).length).toBe(1);
    // h2 之前的 4 个几何装饰必须保留（旧实现会整段丢弃）
    expect((out.match(/position:absolute|position: absolute/g) || []).length).toBeGreaterThanOrEqual(
      4,
    );
    expect(out).toContain('厄尔尼诺是赤道中东太平洋海温异常升高的气候现象');
    const text = visibleText(out);
    for (const kp of KEY_POINTS) expect(text).toContain(kp);
  });

  it('结构不变量：row 恰好两列，ul 归属 55% 文字列（不得成为 row 的第三个子项）', () => {
    const out = makeAgent().injectImagePlaceholderForContentSlide(
      FIXTURE,
      'content-image-left',
      '#e94560',
    );
    const { doc } = parseRoot(out);
    const row = Array.from(doc.querySelectorAll('div')).find((d) =>
      /display:\s*flex/.test(d.getAttribute('style') || '') &&
      /gap:\s*40px/.test(d.getAttribute('style') || ''),
    );
    expect(row).toBeTruthy();
    expect(row!.children.length).toBe(2); // 图列 + 文列，绝不能出现游离的第三个子项
    const ul = doc.querySelector('ul') as HTMLElement;
    expect(ul).toBeTruthy();
    expect(ul.closest('div[style*="flex:0 0 55%"]')).toBeTruthy();
    expect(ul.closest('div[style*="flex:0 0 45%"]')).toBeNull();
  });

  it('幂等：已含占位符的页面原样返回', () => {
    const agent = makeAgent();
    const once = agent.injectImagePlaceholderForContentSlide(
      FIXTURE,
      'content-image-left',
      '#e94560',
    );
    expect(agent.injectImagePlaceholderForContentSlide(once, 'content-image-left', '#e94560')).toBe(
      once,
    );
  });

  it('fail-safe：识别不到正文容器时不改动页面（宁可不配图也不破坏结构）', () => {
    const agent = makeAgent();
    const noBody = '<div style="display:flex;flex-direction:column"><h2>标题</h2></div>';
    expect(agent.injectImagePlaceholderForContentSlide(noBody, 'content-image-left', '#e94560')).toBe(
      noBody,
    );
  });

  it('保护版式（content-compare / content-value-showcase）永不注入', () => {
    const agent = makeAgent();
    for (const pt of ['content-compare', 'content-value-showcase', 'content-table']) {
      expect(agent.injectImagePlaceholderForContentSlide(FIXTURE, pt, '#e94560')).toBe(FIXTURE);
    }
  });

  it('上图下文：横幅图 + 正文 100% 宽，要点文字仍然完整', () => {
    const out = makeAgent().injectImagePlaceholderForContentSlide(
      FIXTURE,
      'content-image-top',
      '#e94560',
    );
    expect(out).not.toBe(FIXTURE);
    expect(out).toContain('max-height:200px');
    const text = visibleText(out);
    for (const kp of KEY_POINTS) expect(text).toContain(kp);
  });
});

describe('结构页无图 · 封面/总结（pres_mtzke4lj 回归）', () => {
  const coverWithPlaceholder = () =>
    '<div style="width:100%;height:100%;display:flex;flex-direction:row;background-color:#fbf3e4">' +
    '<div style="flex:0 0 52%;min-width:0;display:flex;flex-direction:column;justify-content:center">' +
    '<h1>厄尔尼诺：全球气候的脉搏</h1>' +
    '<div style="width:40px;height:40px;border-radius:50%;background:#06D6A0;position:absolute"></div>' +
    '</div>' +
    '<div style="flex:0 0 48%;min-width:0;display:flex;align-items:center;justify-content:center;overflow:hidden;border-radius:16px">' +
    `<img src="${IMAGE_PLACEHOLDER_SRC}" data-image-ratio="4:3" alt="厄尔尼诺气候现象示意图">` +
    '</div>' +
    '</div>';

  it('封面即使被 LLM 写入占位符，也不会被判定生图，且占位图被剥离', () => {
    const decision = resolveSlideImageDecision({
      pageType: 'cover',
      planNeedsImage: false,
      imagePreference: 'content-only',
      imageEnabled: true,
      hasPlaceholder: true,
    });
    expect(decision.needsImage).toBe(false);
    expect(decision.stripPlaceholder).toBe(true);

    const cleaned = stripImagePlaceholders(coverWithPlaceholder(), { collapseLayout: true });
    expect(cleaned).not.toContain('<img');
    expect(cleaned).not.toContain('NOPPT_IMAGE_PLACEHOLDER');
    expect(cleaned).toContain('厄尔尼诺：全球气候的脉搏');
    expect(cleaned).toContain('#06D6A0'); // 几何装饰不受影响
  });

  it('all 偏好下结构页依然不配图', () => {
    for (const pageType of ['cover', 'toc', 'summary']) {
      const decision = resolveSlideImageDecision({
        pageType,
        planNeedsImage: true,
        imagePreference: 'all',
        imageEnabled: true,
        hasPlaceholder: true,
      });
      expect(decision.needsImage).toBe(false);
      expect(decision.reason).toBe('structure-page');
    }
  });
});
