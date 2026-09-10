import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildSelfContainedDeck } from './deck-builder';
import type { Presentation } from '@noppt/core';

/**
 * deck 组装器：逐页 sanitize、资源内联、外壳与翻页运行时。
 * 资源路径依赖 `process.cwd()/data`，故用临时目录隔离。
 */
describe('M4 deck-builder', () => {
  let tmpRoot: string;
  let originalCwd: string;

  beforeAll(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'noppt-deck-test-'));
    originalCwd = process.cwd();
    process.chdir(tmpRoot);
  });

  afterAll(() => {
    process.chdir(originalCwd);
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  const makePresentation = (
    slides: Array<{ title: string; html: string; hidden?: boolean }>,
  ): Presentation =>
    ({
      id: 'p1',
      title: '季度汇报',
      slides: slides.map((s, i) => ({
        id: `s${i}`,
        title: s.title,
        html: s.html,
        hidden: !!s.hidden,
        index: i,
        createdAt: 0,
        updatedAt: 0,
      })),
      zoom: 1,
      width: 1280,
      height: 720,
      transition: 'none',
      createdAt: 0,
      updatedAt: 0,
      version: 1,
    }) as unknown as Presentation;

  it('组装出完整 HTML 文档，含每页 slide 与翻页运行时', async () => {
    const { html } = await buildSelfContainedDeck(
      makePresentation([
        { title: '封面', html: '<div><h1>季度汇报</h1></div>' },
        { title: '要点', html: '<div><h2>要点</h2><ul><li>增长</li></ul></div>' },
      ]),
    );
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('季度汇报');
    expect(html).toContain('<section class="slide is-active" data-index="0">');
    expect(html).toContain('data-index="1"');
    expect(html).toContain('noppt:next');
    expect(html).toContain('ArrowRight');
    expect(html).toContain('只读 · Hermes 产物');
    expect(html).toContain('width:1280px');
    expect(html).toContain('height:720px');
  });

  it('隐藏页不进入 deck', async () => {
    const { html } = await buildSelfContainedDeck(
      makePresentation([
        { title: 'A', html: '<div>A</div>' },
        { title: 'B', html: '<div>B</div>', hidden: true },
      ]),
    );
    expect(html).toContain('>A</div>');
    expect(html).not.toContain('data-index="1"');
  });

  it('本地 /data 图片被内联成 data URL', async () => {
    const imgDir = join(
      tmpRoot,
      'data',
      'tenants',
      't1',
      'users',
      'u1',
      'workspace',
      'presentations',
      'p1',
      'assets',
      'images',
    );
    mkdirSync(imgDir, { recursive: true });
    writeFileSync(
      join(imgDir, 'cover.png'),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    const { html, inlined, failed } = await buildSelfContainedDeck(
      makePresentation([
        {
          title: '带图',
          html: '<div><img src="/data/tenants/t1/users/u1/workspace/presentations/p1/assets/images/cover.png" alt="封面"></div>',
        },
      ]),
    );
    expect(inlined).toBeGreaterThan(0);
    expect(failed).toBe(0);
    expect(html).toContain('data:image/png;base64,');
    expect(html).not.toContain(
      '/data/tenants/t1/users/u1/workspace/presentations/p1/assets/images/cover.png',
    );
  });

  it('内联 style 中的 url() 背景图也被内联', async () => {
    const imgDir = join(tmpRoot, 'data', 'workspace', 'presentations', 'p2', 'assets', 'images');
    mkdirSync(imgDir, { recursive: true });
    writeFileSync(
      join(imgDir, 'bg.png'),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    const { html } = await buildSelfContainedDeck(
      makePresentation([
        {
          title: '背景',
          html: '<div style="background-image:url(/data/workspace/presentations/p2/assets/images/bg.png)">x</div>',
        },
      ]),
    );
    expect(html).toContain('data:image/png;base64,');
  });

  it('危险内容被 sanitize 移除（script / onerror / javascript:）', async () => {
    const { html } = await buildSelfContainedDeck(
      makePresentation([
        {
          title: '危险',
          html: '<div><script>alert(1)</script><img src="x" onerror="alert(2)"><a href="javascript:alert(3)">link</a></div>',
        },
      ]),
    );
    // 只校验舞台内容（外壳自带翻页运行时 script，不应计入）
    const stage = /<div id="stage">([\s\S]*?)<\/div><div class="deck-bar">/.exec(html)?.[1] ?? '';
    expect(stage.length).toBeGreaterThan(0);
    // sanitizeHtmlServerSide 对非白名标签「拆壳」：script 元素被移除（内部文案降级为纯文本，不可执行）
    expect(stage).not.toContain('<script');
    expect(stage).not.toContain('onerror');
    expect(stage).not.toContain('javascript:');
  });

  it('空演示不报错，给出空态提示', async () => {
    const { html } = await buildSelfContainedDeck(makePresentation([]));
    expect(html).toContain('该演示暂无可展示的页面');
  });
});
