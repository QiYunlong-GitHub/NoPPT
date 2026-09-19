import { describe, it, expect } from 'vitest';
import {
  createTableFromHtml,
  createRichTextFromHtml,
} from '../clipboard/html-parsers';

// ================================================================
// clipboard/html-parsers —— 行为锁定测试（characterization test）
//
// 背景：这两个纯函数簇（约 330 行）从 useClipboard.ts 外置而来，
//       涉及 CSS 规则解析 / mso-* 私有属性 / 布局属性剥离 / 注释清理，
//       是粘贴链路的核心，回归面大。本文件锁定其外置后的实际行为，
//       保证后续继续拆分有回归护栏。
// ================================================================

describe('createTableFromHtml（行为锁定）', () => {
  it('含 table 时返回定位表格并打标 data-noppt-table', () => {
    const el = createTableFromHtml('<table><tr><td>A</td><td>B</td></tr></table>', 10, 20);
    expect(el.tagName).toBe('TABLE');
    expect(el.getAttribute('data-noppt-table')).toBe('true');
    expect(el.style.position).toBe('absolute');
    expect(el.style.left).toBe('10px');
    expect(el.style.top).toBe('20px');
    expect(el.style.borderCollapse).toBe('collapse');
  });

  it('单元格补齐默认边框与内边距', () => {
    const el = createTableFromHtml('<table><tr><td>A</td></tr></table>', 0, 0);
    const cell = el.querySelector('td') as HTMLElement;
    // jsdom 会把 #cbd5e1 规范化为 rgb(...) 形式
    expect(cell.style.border).toBe('1px solid rgb(203, 213, 225)');
    expect(cell.style.padding).toBe('8px 12px');
  });

  it('忽略 mso-* 私有属性，保留普通属性', () => {
    const html =
      '<style>.c1 { mso-ansi-font-size: 11pt; color: rgb(0, 0, 255); }</style>' +
      '<table class="c1"><tr><td>A</td></tr></table>';
    const el = createTableFromHtml(html, 0, 0);
    expect(el.style.color).toBe('rgb(0, 0, 255)');
    expect(el.style.getPropertyValue('mso-ansi-font-size')).toBe('');
  });

  it('应用 <style> 中的 class 规则到表格', () => {
    const html =
      '<style>.c1 { color: rgb(255, 0, 0); }</style><table class="c1"><tr><td>A</td></tr></table>';
    const el = createTableFromHtml(html, 0, 0);
    expect(el.style.color).toBe('rgb(255, 0, 0)');
  });

  it('无 table 时回退为文本元素并剥离标签', () => {
    const el = createTableFromHtml('<p>纯文本</p>', 5, 6);
    expect(el.textContent).toContain('纯文本');
    expect(el.textContent).not.toContain('<p>');
  });
});

describe('createRichTextFromHtml（行为锁定）', () => {
  it('返回绝对定位容器并带坐标', () => {
    const el = createRichTextFromHtml('<p>hi</p>', 30, 40);
    expect(el.tagName).toBe('DIV');
    expect(el.style.position).toBe('absolute');
    expect(el.style.left).toBe('30px');
    expect(el.style.top).toBe('40px');
    expect(el.textContent).toContain('hi');
  });

  it('剥离布局类属性（PASTED_LAYOUT_PROPS），保留非布局属性', () => {
    const html = '<div style="width: 500px; height: 300px; color: rgb(1, 2, 3);">x</div>';
    const el = createRichTextFromHtml(html, 0, 0);
    const div = el.querySelector('div') as HTMLElement;
    expect(div.style.width).toBe('');
    expect(div.style.height).toBe('');
    expect(div.style.color).toBe('rgb(1, 2, 3)');
  });

  it('移除 StartFragment / EndFragment 注释', () => {
    const html = '<div><!--StartFragment--><span>a</span><!--EndFragment--></div>';
    const el = createRichTextFromHtml(html, 0, 0);
    expect(el.innerHTML).not.toContain('StartFragment');
    expect(el.innerHTML).not.toContain('EndFragment');
    expect(el.textContent).toContain('a');
  });

  it('移除 <style> 元素本身，不留样式标签', () => {
    const html = '<style>p { color: rgb(0, 128, 0); }</style><p>y</p>';
    const el = createRichTextFromHtml(html, 0, 0);
    expect(el.querySelector('style')).toBeNull();
    expect(el.querySelector('p')).not.toBeNull();
  });
});
