import { describe, it, expect } from 'vitest';
import { enforceTextWrapping } from '../visual-fixes';

describe('enforceTextWrapping · 不得误伤 SVG', () => {
  it('不给 <path>/<polyline>/<polygon>/<line> 注入文本换行样式', () => {
    const html =
      '<div>' +
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e94560">' +
      '<circle cx="12" cy="12" r="10"/>' +
      '<path d="M2 12h20"/>' +
      '<polyline points="12 6 12 12 16 14"/>' +
      '<polygon points="1,1 2,2 3,3"/>' +
      '<line x1="0" y1="0" x2="1" y2="1"/>' +
      '</svg>' +
      '</div>';
    const out = enforceTextWrapping(html);
    expect(out).not.toMatch(/<path[^>]*overflow-wrap/);
    expect(out).not.toMatch(/<polyline[^>]*overflow-wrap/);
    expect(out).not.toMatch(/<polygon[^>]*overflow-wrap/);
    expect(out).not.toMatch(/<line[^>]*overflow-wrap/);
    expect(out).toBe(html);
  });

  it('不破坏 SVG 元素的自闭合写法（防止序列化后形成嵌套）', () => {
    const html = '<svg><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10"/></svg>';
    const out = enforceTextWrapping(html);
    expect(out).toBe(html);
    expect(out).not.toContain('<path d="M2 12h20" style');
    expect(out.match(/<path/g)?.length).toBe(2);
  });

  it('正常给 p / li / h1-h6 / pre 注入换行样式', () => {
    const out = enforceTextWrapping(
      '<h2>标题</h2><p>段落</p><li>要点</li><pre>code</pre><p style="color:#111">样式段落</p>',
    );
    expect(out).toContain('<h2 style="overflow-wrap:break-word;word-break:break-word;">标题</h2>');
    expect(out).toContain('<p style="overflow-wrap:break-word;word-break:break-word;">段落</p>');
    expect(out).toContain('<li style="overflow-wrap:break-word;word-break:break-word;">要点</li>');
    expect(out).toContain('<pre style="overflow-wrap:break-word;word-break:break-word;">code</pre>');
    expect(out).toContain(
      '<p style="color:#111;overflow-wrap:break-word;word-break:break-word">样式段落</p>',
    );
  });

  it('幂等：重复调用不会叠加样式', () => {
    const once = enforceTextWrapping('<p>段落</p><svg><path d="M0 0"/></svg>');
    const twice = enforceTextWrapping(once);
    expect(twice).toBe(once);
  });
});
