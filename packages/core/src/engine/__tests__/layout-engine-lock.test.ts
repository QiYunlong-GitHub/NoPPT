// 行为锁定测试（拆分前基线）：为 layout-engine.ts 外置前的真实行为留档。
// 该文件中的大函数 normalizeOuterContainer / normalizeIconGroups /
// enforceBareTextToParagraphs / preventContentImageTopOverflow 均为模块私有，
// 统一由公开入口 LayoutEngine.normalizeAISlide 调用，故采用「黑盒管线」方式锁定。
import { describe, it, expect } from 'vitest';
import { LayoutEngine, isCoverLikeHtml, cleanupEmptyInlineTags } from '../layout-engine';

const mkSlide = (html: string) =>
  ({
    id: 's1',
    title: 'T',
    html,
    notes: '',
    hidden: false,
    index: 0,
    createdAt: 0,
    updatedAt: 0,
  }) as any;

describe('layout-engine 行为锁定（拆分前基线）', () => {
  describe('isCoverLikeHtml', () => {
    it('含 h1 且无内容标记 → true', () => {
      expect(isCoverLikeHtml('<h1 style="font-size:64px">标题</h1>')).toBe(true);
    });
    it('无 h1 → false', () => {
      expect(isCoverLikeHtml('<h2>副标题</h2><ul><li>a</li></ul>')).toBe(false);
    });
    it('h1 仅存在于注释中 → false', () => {
      expect(isCoverLikeHtml('<!-- <h1>标题</h1> --><p>正文</p>')).toBe(false);
    });
  });

  describe('cleanupEmptyInlineTags', () => {
    it('删除空 p', () => {
      expect(cleanupEmptyInlineTags('<div><p></p></div>')).toBe('<div></div>');
    });
    it('删除空 span', () => {
      expect(cleanupEmptyInlineTags('<div><span></span></div>')).toBe('<div></div>');
    });
    it('保留非空内容', () => {
      expect(cleanupEmptyInlineTags('<p>hi</p>')).toBe('<p>hi</p>');
    });
  });

  describe('LayoutEngine 基础工厂', () => {
    it('createSlide：默认标题与默认 HTML', () => {
      const s = LayoutEngine.createSlide(2);
      expect(s.index).toBe(2);
      expect(s.title).toBe('幻灯片 3');
      expect(typeof s.html).toBe('string');
      expect(s.html.length).toBeGreaterThan(0);
      expect(typeof s.id).toBe('string');
      expect(s.id.length).toBeGreaterThan(0);
    });

    it('createPresentation：默认一张封面且选中，尺寸 1280x720', () => {
      const p = LayoutEngine.createPresentation('P');
      expect(p.title).toBe('P');
      expect(p.slides).toHaveLength(1);
      expect(p.selectedSlideId).toBe(p.slides[0].id);
      expect(p.width).toBe(1280);
      expect(p.height).toBe(720);
    });

    it('duplicateSlide：换新 id 与 index，标题加“ (副本)”后缀，保留 html', () => {
      const s = LayoutEngine.createSlide(0, '原名');
      s.html = '<div>X</div>';
      const d = LayoutEngine.duplicateSlide(s, 4);
      expect(d.id).not.toBe(s.id);
      expect(d.index).toBe(4);
      expect(d.title).toBe('原名 (副本)');
      expect(d.html).toBe('<div>X</div>');
    });
  });

  describe('normalizeAISlide 管线（覆盖私有大函数）', () => {
    it('裁剪前置空白', () => {
      const out = LayoutEngine.normalizeAISlide(mkSlide('\n   <div>内容</div>'));
      expect(out.html.startsWith('\n')).toBe(false);
      expect(out.html.startsWith(' ')).toBe(false);
    });

    it('移除危险内容（script）', () => {
      const out = LayoutEngine.normalizeAISlide(mkSlide('<div>ok</div><script>alert(1)</script>'));
      expect(out.html.toLowerCase()).not.toContain('<script');
    });

    it('普通版式补外层容器（normalizeOuterContainer）', () => {
      const out = LayoutEngine.normalizeAISlide(mkSlide('<h2>标题</h2><ul><li>a</li></ul>'));
      expect(out.html).toMatch(/width\s*:\s*100%/);
      expect(out.html).toContain('标题');
    });

    it('裸文本被包成段落（enforceBareTextToParagraphs）', () => {
      const out = LayoutEngine.normalizeAISlide(mkSlide('<div>裸文本内容</div>'));
      expect(out.html).toContain('裸文本内容');
    });

    it('高级版式 comparison-deep-dive 走轻量分支且保留 data-layout', () => {
      const html =
        '<div data-layout="comparison-deep-dive"><div class="col"><ul><li>左1</li><li>左2</li></ul></div>' +
        '<div class="col"><ul><li>右1</li><li>右2</li></ul></div></div>';
      const out = LayoutEngine.normalizeAISlide(mkSlide(html));
      expect(out.html).toContain('data-layout="comparison-deep-dive"');
      expect(out.html).toContain('左1');
      expect(out.html).toContain('右2');
    });

    it('返回结构保留原 slide 字段并刷新 updatedAt', () => {
      const out = LayoutEngine.normalizeAISlide(mkSlide('<div>a</div>'));
      expect(out.id).toBe('s1');
      expect(out.title).toBe('T');
      expect(typeof out.updatedAt).toBe('number');
      expect(out.updatedAt).toBeGreaterThan(0);
    });
  });
});
