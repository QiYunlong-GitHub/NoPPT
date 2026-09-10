import { describe, it, expect } from 'vitest';
import { assertReferenceSizes, dataUrlBytes, truncateReferenceText, MAX_REFERENCE_HTML_BYTES } from './reference-input';
import { McpError } from '../../common/mcp-errors';
import { readMcpEnv } from '../../common/env';

/** TC-110（规格 5.2.1）：referenceText 截断（超长/边界/空值）与素材大小校验。 */
describe('M8 素材入参', () => {
  describe('truncateReferenceText', () => {
    it('超长截断并标记 truncated', () => {
      const r = truncateReferenceText('x'.repeat(100), 30);
      expect(r.referenceText).toHaveLength(30);
      expect(r.truncated).toBe(true);
    });

    it('恰好等于上限不截断', () => {
      const r = truncateReferenceText('x'.repeat(30), 30);
      expect(r.referenceText).toHaveLength(30);
      expect(r.truncated).toBe(false);
    });

    it('短于上限原样返回', () => {
      const r = truncateReferenceText('hello', 30);
      expect(r.referenceText).toBe('hello');
      expect(r.truncated).toBe(false);
    });

    it.each([undefined, null, '', '   '])('空值 %s 不截断', (v) => {
      const r = truncateReferenceText(v, 30);
      expect(r.truncated).toBe(false);
      expect(r.referenceText).toBeUndefined();
    });

    it('maxChars <= 0 视为不限制', () => {
      const long = 'x'.repeat(1000);
      expect(truncateReferenceText(long, 0).truncated).toBe(false);
      expect(truncateReferenceText(long, 0).referenceText).toBe(long);
    });

    it('按字符（非字节）截断，中文不会被切坏', () => {
      const r = truncateReferenceText('素材内容'.repeat(100), 20);
      expect(r.referenceText).toHaveLength(20);
      expect(r.truncated).toBe(true);
    });
  });

  describe('assertReferenceSizes', () => {
    const env = readMcpEnv();

    it('referenceHtml 超 2MB → E3003', () => {
      expect(() => assertReferenceSizes({ referenceHtml: 'x'.repeat(MAX_REFERENCE_HTML_BYTES + 1) }, env)).toThrow(McpError);
      try {
        assertReferenceSizes({ referenceHtml: 'x'.repeat(MAX_REFERENCE_HTML_BYTES + 1) }, env);
      } catch (e) {
        expect((e as McpError).code).toBe('E3003');
      }
    });

    it('referenceHtml 未超限 → 放行', () => {
      expect(() => assertReferenceSizes({ referenceHtml: '<div>ok</div>' }, env)).not.toThrow();
    });

    it('referenceImage data URL 超限 → E3004', () => {
      const big = 'data:image/png;base64,' + 'A'.repeat(Math.ceil((env.maxRefImageBytes / 3) * 4) + 100);
      expect(dataUrlBytes(big)).toBeGreaterThan(env.maxRefImageBytes);
      expect(() => assertReferenceSizes({ referenceImage: big }, env)).toThrow(McpError);
    });

    it('远程 http(s) 图片不做体积预检（交由落盘环节处理）', () => {
      expect(() => assertReferenceSizes({ referenceImage: 'https://example.com/a.png' }, env)).not.toThrow();
    });
  });

  describe('dataUrlBytes', () => {
    it('空串与非 data URL 返回 0', () => {
      expect(dataUrlBytes('')).toBe(0);
      expect(dataUrlBytes('https://x/y.png')).toBe(0);
    });

    it('base64 长度按 3/4 折算', () => {
      expect(dataUrlBytes('data:image/png;base64,' + 'A'.repeat(400))).toBe(300);
    });
  });
});
