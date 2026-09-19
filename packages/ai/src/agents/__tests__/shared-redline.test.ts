// 红线测试：锁定 shared.ts 二次拆分后，5 个对外具名导出仍能经
// barrel → agent → agents/index → src/index 多层再导出可达。
// 这是 packages/ai/src/index.ts 第 29–35 行具名导出的行为锁定。
import { describe, it, expect } from 'vitest';
import {
  resolveEffectivePrimaryColor,
  resolveProposalPrimaryColor,
  COLOR_THEMES,
  darkenColor,
  assertHueClose,
} from '../../index';

describe('shared.ts 对外具名导出红线（多层 barrel 再导出）', () => {
  it('5 个对外符号经多层再导出仍可达且类型正确', () => {
    expect(typeof resolveEffectivePrimaryColor).toBe('function');
    expect(typeof resolveProposalPrimaryColor).toBe('function');
    expect(typeof COLOR_THEMES).toBe('object');
    expect(COLOR_THEMES).toHaveProperty('blue');
    expect(typeof darkenColor).toBe('function');
    expect(typeof assertHueClose).toBe('function');
  });
});
