import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runVlmCritique } from './vlm-critique';

function makeProvider(issues: any[]) {
  return {
    config: { model: 'mock-vlm' },
    chat: async () => ({
      content: JSON.stringify({ overallScore: 7, summary: 'ok', issues }),
      model: 'mock-vlm',
      usage: { promptTokens: 2000, completionTokens: 50, totalTokens: 2050 },
    }),
  } as any;
}

describe('runVlmCritique 参考豁免（FR-17.2 / AC-36）', () => {
  let shot: string;
  beforeAll(() => {
    shot = path.join(os.tmpdir(), `vlm-ref-test-${Date.now()}.png`);
    // 仅用于满足 runVlmCritique 的 >=1024 字节截图前置校验（不解析 PNG 内容）
    fs.writeFileSync(shot, Buffer.alloc(1500, 0x41));
  });
  afterAll(() => {
    try {
      fs.unlinkSync(shot);
    } catch {
      /* ignore */
    }
  });

  it('hasReference: 通用规范类 fatal 偏差降级为 warn（不触发 regenerationRequired）', async () => {
    const provider = makeProvider([
      {
        title: '配色超出规范',
        severity: 'fatal',
        problem: '使用了 5 种颜色，不符合通用配色规范（颜色 ≤3-4）',
        rootCause: 'html',
        fix: '减少颜色数量',
      },
      {
        title: '间距不规范',
        severity: 'fatal',
        problem: '元素间距未遵循 8pt 网格通用规范',
        rootCause: 'html',
        fix: '对齐到 8/16/24',
      },
    ]);
    const res = await runVlmCritique(provider, shot, 0, '测试页', 'final', {
      hasReference: true,
      source: 'image',
    });
    expect(res.issues.length).toBe(2);
    for (const i of res.issues) {
      expect(i.severity).toBe('warn');
      expect(i.metadata?.relaxedByReference).toBe(true);
    }
  });

  it('hasReference: L0 无障碍底线（对比度/字号/遮挡/裁切）仍保留 fatal', async () => {
    const provider = makeProvider([
      {
        title: '对比度过低',
        severity: 'fatal',
        problem: '正文与背景对比度仅 2:1，低于 WCAG AA 4.5:1',
        rootCause: 'html',
        fix: '提高对比',
      },
      {
        title: '字号过小',
        severity: 'fatal',
        problem: '正文字号仅 10px，难以阅读',
        rootCause: 'html',
        fix: '调大',
      },
    ]);
    const res = await runVlmCritique(provider, shot, 0, '测试页', 'final', {
      hasReference: true,
      source: 'image',
    });
    expect(res.issues.every((i: any) => i.severity === 'error')).toBe(true);
    expect(res.issues.every((i: any) => i.metadata.relaxedByReference === undefined)).toBe(true);
  });

  it('无 hasReference: fatal 仍映射为 error（不放松）', async () => {
    const provider = makeProvider([
      {
        title: '配色过多',
        severity: 'fatal',
        problem: '使用了 5 种颜色',
        rootCause: 'html',
        fix: '减少',
      },
    ]);
    const res = await runVlmCritique(provider, shot, 0, '测试页', 'final');
    expect(res.issues[0].severity).toBe('error');
    expect((res.issues[0].metadata as any).relaxedByReference).toBeUndefined();
  });
});
