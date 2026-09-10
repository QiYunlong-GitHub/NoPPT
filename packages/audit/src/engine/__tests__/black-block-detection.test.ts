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

// 现场报文 05 的黑块标题：background 简写写在 clip 之后 → 黑块 + 透明字
const BLACK_BLOCK =
  '<div style="width:100%;height:100%;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;background-color:#fff;">' +
  '<h1 style="font-size:92px;color:#22223b;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;background:linear-gradient(135deg,#22223b,#5c5c72);">标题</h1></div>';

const NORMAL =
  '<div style="width:100%;height:100%;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;background-color:#fff;">' +
  '<h1 style="font-size:92px;color:#22223b;">标题</h1></div>';

// 仅启用确定性引擎（layout），避免拉起 VLM；黑块检测在引擎循环之后独立执行。
const cfg = {
  engines: { layout: true, visual: false, content: false, fidelity: false, sanitization: false },
} as any;

describe('AuditEngine 黑块标题致命检测（regression · pres_mtrcm1nx）', () => {
  it('含黑块标题的幻灯片触发 regenerationRequired 并发出 visual.black-block-title', async () => {
    const engine = new AuditEngine(cfg);
    const report = await engine.auditPresentation(makePresentation(BLACK_BLOCK));
    expect(report.regenerationRequired).toBe(true);
    expect(report.issues.some((i) => i.ruleId === 'visual.black-block-title')).toBe(true);
  });

  it('正常幻灯片不误报', async () => {
    const engine = new AuditEngine(cfg);
    const report = await engine.auditPresentation(makePresentation(NORMAL));
    expect(report.regenerationRequired).toBe(false);
    expect(report.issues.some((i) => i.ruleId === 'visual.black-block-title')).toBe(false);
  });
});
