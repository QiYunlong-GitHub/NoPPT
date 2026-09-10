import { describe, it, expect } from 'vitest';
import { AuditEngine } from '../audit-engine';

function makePresentation(html: string): any {
  return {
    id: 'p1',
    title: 'Test',
    slides: [
      {
        id: 's1',
        title: 'S1',
        html,
        zoom: 1,
        width: 1280,
        height: 720,
        transition: 'none',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        version: 1,
      },
    ],
    zoom: 1,
    width: 1280,
    height: 720,
    transition: 'none',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    version: 1,
  };
}

// 含居中三件套（justify-content/align-items/text-align:center）且不含黑块样式，用作「页面居中」样本
const CENTERED =
  '<div style="width:100%;height:100%;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;background-color:#fff;">' +
  '<h1 style="font-size:92px;color:#22223b;">标题</h1></div>';

// 非居中：破坏居中三件套（text-align:left 且 justify/align 顶左），用作「页面非居中」样本
const LEFT_ALIGNED =
  '<div style="width:100%;height:100%;display:flex;flex-direction:column;justify-content:flex-start;align-items:flex-start;text-align:left;background-color:#fff;">' +
  '<h1 style="font-size:92px;color:#22223b;">标题</h1></div>';

// 最小化参考视觉属性：content 分类可继承 global（global-content-fallback），cover/summary 不可继承 global
function makeRva(
  globalComposition?: 'left-aligned' | 'centered',
  contentComposition?: 'left-aligned' | 'centered',
): any {
  return {
    global: {
      uploaded: !!globalComposition,
      visual: globalComposition ? { composition: globalComposition } : undefined,
    },
    byCategory: {
      cover: { uploaded: false },
      content: {
        uploaded: !!contentComposition,
        visual: contentComposition ? { composition: contentComposition } : undefined,
      },
      summary: { uploaded: false },
    },
  };
}

// 仅启用确定性引擎（layout），避免拉起 VLM；构图检测在引擎循环之后独立执行
const cfg = {
  engines: { layout: true, visual: false, content: false, fidelity: false, sanitization: false },
} as any;

const RULE = 'layout.composition-mismatch';

describe('AuditEngine 构图不符致命检测（regeneration · pres_mtrcm1nx 同批守护）', () => {
  it('正向·单份 global 左对齐参考落到 content + 页面居中 → 触发 layout.composition-mismatch', async () => {
    const engine = new AuditEngine(cfg);
    const plan: any = { slides: [{ pageType: 'content-cards' }] };
    const report = await engine.auditPresentation(makePresentation(CENTERED), plan, undefined, {
      visualAttributes: makeRva('left-aligned'),
    } as any);
    const issue = report.issues.find((i) => i.ruleId === RULE);
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe('error');
  });

  it('正向·content 显式上传左对齐参考 + 页面居中 → 触发 layout.composition-mismatch', async () => {
    const engine = new AuditEngine(cfg);
    const plan: any = { slides: [{ pageType: 'content-cards' }] };
    const report = await engine.auditPresentation(makePresentation(CENTERED), plan, undefined, {
      visualAttributes: makeRva(undefined, 'left-aligned'),
    } as any);
    const issue = report.issues.find((i) => i.ruleId === RULE);
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe('error');
  });

  it('反向·无参考属性 → 不触发', async () => {
    const engine = new AuditEngine(cfg);
    const plan: any = { slides: [{ pageType: 'content-cards' }] };
    const report = await engine.auditPresentation(makePresentation(CENTERED), plan, undefined, {
      visualAttributes: makeRva(),
    } as any);
    expect(report.issues.some((i) => i.ruleId === RULE)).toBe(false);
  });

  it('反向·参考构图为居中（非左对齐）+ 页面居中 → 不触发', async () => {
    const engine = new AuditEngine(cfg);
    const plan: any = { slides: [{ pageType: 'content-cards' }] };
    const report = await engine.auditPresentation(makePresentation(CENTERED), plan, undefined, {
      visualAttributes: makeRva('centered'),
    } as any);
    expect(report.issues.some((i) => i.ruleId === RULE)).toBe(false);
  });

  it('反向·cover 页 + 单份 global 左对齐参考（跨分类门控）→ 不触发', async () => {
    const engine = new AuditEngine(cfg);
    const plan: any = { slides: [{ pageType: 'cover' }] };
    const report = await engine.auditPresentation(makePresentation(CENTERED), plan, undefined, {
      visualAttributes: makeRva('left-aligned'),
    } as any);
    expect(report.issues.some((i) => i.ruleId === RULE)).toBe(false);
  });

  it('反向·参考左对齐但页面根容器非居中 → 不触发', async () => {
    const engine = new AuditEngine(cfg);
    const plan: any = { slides: [{ pageType: 'content-cards' }] };
    const report = await engine.auditPresentation(makePresentation(LEFT_ALIGNED), plan, undefined, {
      visualAttributes: makeRva('left-aligned'),
    } as any);
    expect(report.issues.some((i) => i.ruleId === RULE)).toBe(false);
  });
});
