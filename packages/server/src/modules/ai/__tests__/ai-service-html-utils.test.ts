// ================================================================
// AiService HTML 工具方法 —— 行为锁定测试（characterization test）
//
// 目的：ai.service.ts（5433 行）目前零测试覆盖，而 Phase 3 计划把
//       postProcessPresentation / 图片注入 / ensureSemanticWrapping 等
//       大块逻辑外置。本文件先锁定「现状行为」，保证后续纯搬移不会改变输出。
//
// 说明：这些方法原为 AiService 的 private 方法，重构后已外置到 utils/html-string.ts
//       （函数体逐字节搬移）。本文件直接锁定新模块的对外行为。
// ================================================================
import { describe, it, expect } from 'vitest';
import {
  collectImageRefs,
  isLocalAssetUrl,
  replaceImageUrlInHtml,
  mapRatioToSize,
  extractRatioFromImgTag,
  _serverHasBareText,
  ensureSemanticWrapping,
} from '../utils/html-string';

const svc = {
  collectImageRefs,
  isLocalAssetUrl,
  replaceImageUrlInHtml,
  mapRatioToSize,
  extractRatioFromImgTag,
  _serverHasBareText,
  ensureSemanticWrapping,
} as Record<string, any>;

describe('AiService HTML 工具方法（行为锁定）', () => {
  describe('collectImageRefs', () => {
    it('空串 / 无图 HTML 返回空集合', () => {
      expect(svc.collectImageRefs('')).toEqual({ imgs: [], bgImages: [] });
      expect(svc.collectImageRefs('<div>纯文本</div>')).toEqual({ imgs: [], bgImages: [] });
    });

    it('抽取 img 标签的 src（含单引号写法）', () => {
      const html = `<div><img src="/data/a.png" style="width:10px"><img src='/data/b.png'></div>`;
      const { imgs } = svc.collectImageRefs(html);
      expect(imgs.map((i: any) => i.src)).toEqual(['/data/a.png', '/data/b.png']);
    });

    it('抽取 CSS background-image 的 url', () => {
      const html = `<div style="background-image:url('/data/bg.png');"></div>`;
      const { bgImages } = svc.collectImageRefs(html);
      expect(bgImages).toHaveLength(1);
      expect(bgImages[0].url).toBe('/data/bg.png');
    });

    it('剥离 src 两端的反引号与多余引号', () => {
      const html = '<img src="`/data/x.png`">';
      const { imgs } = svc.collectImageRefs(html);
      expect(imgs[0].src).toBe('/data/x.png');
    });

    it('img 与 background-image 同时存在时分别归类', () => {
      const html = `<img src="/data/i.png"><div style="background-image:url(/data/b.png)"></div>`;
      const r = svc.collectImageRefs(html);
      expect(r.imgs).toHaveLength(1);
      expect(r.bgImages).toHaveLength(1);
    });
  });

  describe('isLocalAssetUrl', () => {
    it('/data/ 前缀判定为本地资源', () => {
      expect(svc.isLocalAssetUrl('/data/uploads/a.png')).toBe(true);
    });

    it('data:、#、http://localhost、占位符、空值均判定为非本地', () => {
      expect(svc.isLocalAssetUrl('data:image/png;base64,AAA')).toBe(false);
      expect(svc.isLocalAssetUrl('#anchor')).toBe(false);
      expect(svc.isLocalAssetUrl('http://localhost:3001/data/a.png')).toBe(false);
      expect(svc.isLocalAssetUrl('NOPPT_IMAGE_PLACEHOLDER')).toBe(false);
      expect(svc.isLocalAssetUrl('NOPPT_BG_PLACEHOLDER')).toBe(false);
      expect(svc.isLocalAssetUrl('')).toBe(false);
    });
  });

  describe('replaceImageUrlInHtml', () => {
    it('精确替换命中的 img src，不影响其它图片', () => {
      const html = `<img src="/data/old.png"><img src="/data/keep.png">`;
      const out = svc.replaceImageUrlInHtml(html, '/data/old.png', '/data/new.png');
      expect(out).toContain('src="/data/new.png"');
      expect(out).toContain('src="/data/keep.png"');
    });

    it('同时替换 background-image 中的同源 url', () => {
      const html = `<div style="background-image:url('/data/old.png')"></div>`;
      const out = svc.replaceImageUrlInHtml(html, '/data/old.png', '/data/new.png');
      expect(out).toContain('/data/new.png');
      expect(out).not.toContain('/data/old.png');
    });

    it('未命中时原样返回', () => {
      const html = `<img src="/data/a.png">`;
      expect(svc.replaceImageUrlInHtml(html, '/data/none.png', '/data/new.png')).toBe(html);
    });
  });

  describe('_serverHasBareText', () => {
    it('容器层出现裸文本 -> true', () => {
      expect(svc._serverHasBareText('<div style="x">裸文本</div>')).toBe(true);
    });

    it('文本全部在语义标签内 -> false', () => {
      expect(svc._serverHasBareText('<div><p>正文</p><h2>标题</h2></div>')).toBe(false);
    });

    it('仅空白字符 -> false', () => {
      expect(svc._serverHasBareText('<div>   \n  </div>')).toBe(false);
    });

    it('注释内容不算裸文本', () => {
      expect(svc._serverHasBareText('<div><!-- 注释 --></div>')).toBe(false);
    });

    it('容器层自闭合标签（br/img）不算裸文本', () => {
      expect(svc._serverHasBareText('<div><br><img src="a.png"></div>')).toBe(false);
    });

    it('未知标签内层文本不视为裸文本（避免误伤未入表标签）', () => {
      expect(svc._serverHasBareText('<div><custom-tag>文本</custom-tag></div>')).toBe(false);
    });
  });

  describe('ensureSemanticWrapping', () => {
    it('空串原样返回', () => {
      expect(svc.ensureSemanticWrapping('')).toBe('');
    });

    it('无裸文本时短路：逐字节原样返回（B3S 快路径）', () => {
      const html = '<div style="color:red"><p>正文</p><h2>标题</h2></div>';
      expect(svc.ensureSemanticWrapping(html)).toBe(html);
    });

    it('存在裸文本时执行包裹：结果不再是裸文本', () => {
      const html = '<div>裸文本</div>';
      const out = svc.ensureSemanticWrapping(html);
      expect(out).not.toBe(html);
      // 包裹后应重新满足「无裸文本」
      expect(svc._serverHasBareText(out)).toBe(false);
    });

    it('包裹结果保留原有文本内容', () => {
      const out = svc.ensureSemanticWrapping('<div>Hello World</div>');
      expect(out).toContain('Hello World');
    });
  });
});
