import { describe, it, expect } from 'vitest';
// 从源文件导入内部测试辅助（未 export 时需要 import 别名来暴露）
import {
  resolveEffectivePrimaryColor,
  resolveProposalPrimaryColor,
  assertHueClose,
  darkenColor,
  COLOR_THEMES,
  computeU17EffectivePrimaryColor,
  buildPlanningMessagesForTest,
} from './html-presentation-agent-test-harness';

describe('FR-9.4 resolveEffectivePrimaryColor — 5 级优先级', () => {
  // U-14 — 自定义 hex 优先级最高（options.primaryColor 存在时忽略 colorTheme/design）
  it('U-14 options.primaryColor(自定义hex) 优先级最高', () => {
    const result = resolveEffectivePrimaryColor(
      { primaryColor: '#ff0000', colorTheme: 'orange' },
      { colorTheme: 'blue', primaryColor: '#2563eb' },
      '#2563eb',
    );
    expect(result).toBe('#ff0000');
  });

  // U-15 — colorTheme 优先于 design.primaryColor（本案例核心问题）
  it('U-15 options.colorTheme=orange 应返回 #ea580c（忽略 design.primaryColor=#2563eb）', () => {
    const result = resolveEffectivePrimaryColor(
      { colorTheme: 'orange' },
      { primaryColor: '#2563eb' },
      '#2563eb',
    );
    expect(result).toBe(COLOR_THEMES['orange']);
    expect(result).toBe('#ea580c');
  });

  // U-15b（补充）— design.colorTheme 在 options.colorTheme 不存在时生效（FR-9.4 第 3 级）
  it('U-15b 无 options.colorTheme 但有 design.colorTheme=purple 应返回 #7c3aed', () => {
    const result = resolveEffectivePrimaryColor(
      {},
      { colorTheme: 'purple', primaryColor: '#2563eb' },
      '#2563eb',
    );
    expect(result).toBe(COLOR_THEMES['purple']);
    expect(result).toBe('#7c3aed');
  });

  // U-16 — 全无时 fallback #2563eb
  it('U-16 全空时 fallback #2563eb', () => {
    const result = resolveEffectivePrimaryColor(null, null, '#2563eb');
    expect(result).toBe('#2563eb');
  });

  // U-16b — 只有 design.primaryColor 时，使用该值（FR-9.4 第 4 级）
  it('U-16b 仅 design.primaryColor=#4b5563，返回它', () => {
    const result = resolveEffectivePrimaryColor(
      {},
      { primaryColor: '#4b5563' },
      '#2563eb',
    );
    expect(result).toBe('#4b5563');
  });
});

describe('resolveProposalPrimaryColor — 设计提案阶段参考优先单源（修复缺口1）', () => {
  // 构造最小 ReferenceVisualAttributes：按分类 uploaded + style.primaryColor
  const makeRva = (colors?: Partial<Record<'cover' | 'content' | 'summary', string>>): any => ({
    byCategory: {
      cover: colors?.cover ? { uploaded: true, style: { primaryColor: colors.cover } } : { uploaded: false },
      content: colors?.content ? { uploaded: true, style: { primaryColor: colors.content } } : { uploaded: false },
      summary: colors?.summary ? { uploaded: true, style: { primaryColor: colors.summary } } : { uploaded: false },
    },
    global: { uploaded: false },
  });

  // P-1 — 参考主色覆盖用户 colorTheme=blue（本案例核心：提案应返回 #d80000 而非 #2563eb）
  it('P-1 存在参考主色时，即便用户指定 blue 也返回参考色 #d80000', () => {
    const result = resolveProposalPrimaryColor({
      referenceVisualAttributes: makeRva({ content: '#d80000' }),
      userColorTheme: 'blue',
      userPrimaryColor: undefined,
    });
    expect(result).toBe('#d80000');
  });

  // P-2 — 参考主色覆盖用户显式 primaryColor
  it('P-2 存在参考主色时，覆盖用户显式 primaryColor', () => {
    const result = resolveProposalPrimaryColor({
      referenceVisualAttributes: makeRva({ content: '#d80000' }),
      userColorTheme: 'blue',
      userPrimaryColor: '#123456',
    });
    expect(result).toBe('#d80000');
  });

  // P-3 — deck 级代表取 content（content > cover > summary）
  it('P-3 deck 级代表取 content，优先于 cover/summary', () => {
    const result = resolveProposalPrimaryColor({
      referenceVisualAttributes: makeRva({ cover: '#e60012', content: '#d80000', summary: '#c70000' }),
      userColorTheme: 'blue',
    });
    expect(result).toBe('#d80000');
  });

  // P-4 — 无参考时回落用户 colorTheme=blue → #2563eb（向后兼容）
  it('P-4 无参考时回落用户 colorTheme=blue → #2563eb', () => {
    const result = resolveProposalPrimaryColor({
      referenceVisualAttributes: makeRva(),
      userColorTheme: 'blue',
    });
    expect(result).toBe('#2563eb');
  });

  // P-5 — 无参考且用户也未指定 → 默认蓝 #2563eb（逐字节一致）
  it('P-5 完全无参考无用户参数 → #2563eb', () => {
    const result = resolveProposalPrimaryColor({});
    expect(result).toBe('#2563eb');
  });

  // P-6 — 无参考但用户显式 hex → 用户色优先
  it('P-6 无参考时用户显式 primaryColor 优先于 colorTheme', () => {
    const result = resolveProposalPrimaryColor({
      referenceVisualAttributes: makeRva(),
      userColorTheme: 'orange',
      userPrimaryColor: '#abcdef',
    });
    expect(result).toBe('#abcdef');
  });
});

describe('FR-8 L-1 assertHueClose — 色相一致性断言 + darker 重算', () => {
  // U-9 — (#2563eb蓝, #bb460a橙深) ΔH≈197°，断言失败 → darker 自动校正为 darkenColor(#2563eb,20%) ≈ #1e4fbc
  it('U-9 蓝+橙深 跨色系 ΔH≈197°，断言失败并校正 darker', () => {
    const r = assertHueClose('#2563eb', '#bb460a', 20);
    expect(r.pass).toBe(false);
    // 校正后的 darker 应与 #2563eb 色相差 ≤ 20°（深蓝）
    const r2 = assertHueClose('#2563eb', r.correctedDarker, 20);
    expect(r2.pass).toBe(true);
  });

  // 活力橙同色系：#ea580c 与 darkenColor(#ea580c,20%)=#bb460a 应 pass
  it('U-9b 活力橙同色系断言通过', () => {
    const darker = darkenColor('#ea580c', 20);
    expect(darker.toLowerCase()).toBe('#bb460a');
    const r = assertHueClose('#ea580c', darker, 20);
    expect(r.pass).toBe(true);
    expect(r.correctedDarker.toLowerCase()).toBe('#bb460a');
  });
});

// ======================= 本次修复新增测试 =======================
// 背景：用户报告后端报文中 system prompt 写死 primaryColor=#ea580c，
// 但 user prompt 要求主色调 #2563eb，二者矛盾。根因是 generatePlan() 内部：
//   - buildPlanningPrompt 内 expectedPrimaryHex 取 COLOR_THEMES[colorTheme]
//     或 fallback #2563eb，完全忽略显式传入的 primaryColor 变量
//   - user message 却使用原始的 primaryColor 参数
// 修复策略：
//   (1) 新增 computeU17EffectivePrimaryColor()，复现 U-17 强制覆盖公式，
//       在进入 LLM 前就得到最终主色；
//   (2) buildPlanningPrompt() 接收 effectivePrimaryColor 参数并用它
//       替换 system prompt 模板的 {{EXPECTED_PRIMARY_COLOR}}；
//   (3) user message 中也使用同一 effectivePrimaryColor；
//   (4) 保证 system prompt 与 user message 的主色值 100% 一致（一致化）。

describe('U-17-L 规划阶段主色一致化（system prompt == user prompt == U-17 强制值）', () => {
  it('U-17-L1：colorTheme=orange → 主色必须为 #ea580c（忽略 primaryColor=#2563eb 输入）', () => {
    const eff = computeU17EffectivePrimaryColor(
      'business',
      'orange',
      '#2563eb',
    );
    expect(eff).toBe('#ea580c');
    expect(eff).toBe(COLOR_THEMES.orange);
  });

  it('U-17-L2：无 colorTheme 但有 style=business → 主色必须为 #2563eb（即便 primaryColor=#ff0000 传错，U-17 会用 style fallback 优先；若 primaryColor 有合法值 style=orange 等也应匹配）', () => {
    const eff = computeU17EffectivePrimaryColor(
      'business',
      undefined,
      '#ff0000',
    );
    // U-17: colorTheme 无 → COLOR_THEMES[style] || primaryColor || fallback
    // COLOR_THEMES['business'] = '#2563eb'，所以期望 #2563eb
    expect(eff).toBe('#2563eb');
  });

  it('U-17-L3：style=orange（本身是 COLOR_THEMES key）、无 colorTheme，primaryColor 不合法 → 使用 COLOR_THEMES.orange = #ea580c', () => {
    const eff = computeU17EffectivePrimaryColor(
      'orange',
      undefined,
      'not-a-hex',
    );
    expect(eff).toBe('#ea580c');
  });

  it('U-17-L4：style 无匹配、colorTheme 未传，primaryColor=#aabbcc → 返回该 primaryColor（U-17 第三分支 || primaryColor）', () => {
    const eff = computeU17EffectivePrimaryColor(
      'unknown-style',
      undefined,
      '#aabbcc',
    );
    expect(eff).toBe('#aabbcc');
  });

  it('U-17-L5：planning 阶段 system prompt 与 user prompt 中主色必须完全一致', () => {
    // 用户报告的典型矛盾场景：colorTheme=orange（#ea580c），但前端传入 primaryColor=#2563eb
    const messages = buildPlanningMessagesForTest({
      topic: '厄尔尼诺简介',
      style: 'business',
      audience: '通用商务受众',
      slideSpec: { exact: 5 },
      density: 'normal',
      imagePreference: 'content-only',
      primaryColor: '#2563eb',
      backgroundEnabled: false,
      pageHints: { contentOnly: false, disableCover: false, disableToc: false, disableConclusion: false },
      iconStyle: 'auto',
      fontFamily: 'sans',
      colorTheme: 'orange',
      referenceHtmlBrief: '',
      userSettingsOverride: '',
    });

    const system = messages.find((m: any) => m.role === 'system')?.content as string;
    const user = messages.find((m: any) => m.role === 'user')?.content as string;

    expect(system).toBeDefined();
    expect(user).toBeDefined();

    // U-17 公式：colorTheme=orange → force=#ea580c
    const expectedForced = '#ea580c';

    // ① system prompt 中的示例 JSON 里 "primaryColor": 必须与 U-17 forced 相同
    const match = system.match(/"primaryColor"\s*:\s*"([^"]+)"/);
    expect(match).toBeTruthy();
    expect(match![1]).toBe(expectedForced);

    // ② user prompt 中主色必须与 system 相同（不能再是用户传入的原始 primaryColor
    //    —— 之前就是这点导致 LLM 收到两个互相矛盾的指令）
    expect(user).toContain(expectedForced);
    // 之前的错：user 会写原始用户传入的主色值，但 system 用的是另一值。修复后
    // user 中不得再出现任何「与 expectedForced 不一致的 6 位 hex 主色值」：
    const userHex = user.match(/#[0-9a-fA-F]{6}/g) || [];
    const mismatch = userHex.filter(
      (h) => h.toLowerCase() !== (expectedForced as string).toLowerCase(),
    );
    expect(mismatch).toEqual([]);
  });

  it('U-17-L6：无 colorTheme、style=creative 时，主色走 COLOR_THEMES.creative（紫 #7c3aed），system/user 均一致', () => {
    const messages = buildPlanningMessagesForTest({
      topic: '测试',
      style: 'creative',
      audience: '',
      slideSpec: { exact: 5 },
      density: 'normal',
      imagePreference: 'content-only',
      primaryColor: '#111111',
      backgroundEnabled: false,
      pageHints: { contentOnly: false, disableCover: false, disableToc: false, disableConclusion: false },
      iconStyle: 'auto',
      fontFamily: 'sans',
      colorTheme: undefined,
      referenceHtmlBrief: '',
      userSettingsOverride: '',
    });
    const system = messages.find((m: any) => m.role === 'system')?.content as string;
    const user = messages.find((m: any) => m.role === 'user')?.content as string;
    const expected = '#7c3aed'; // COLOR_THEMES.creative
    const m = system.match(/"primaryColor"\s*:\s*"([^"]+)"/);
    expect(m).toBeTruthy();
    expect(m![1]).toBe(expected);
    expect(user).toContain(expected);
  });
});
