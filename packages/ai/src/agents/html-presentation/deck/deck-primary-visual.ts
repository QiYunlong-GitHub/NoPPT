/**
 * 由 deck 级统一主色派生装饰色（内部模块，不进入任何 barrel 导出）。
 *
 * 设计取舍：
 * - 只派生「主色 hex + 同色相 rgba 变体」，不引入新的十六进制色值，
 *   因此不会与 `semanticPaletteHexes` 白名单或单色系后处理冲突；
 * - 仅确定性 Deck 生产路径 opt-in；`VISUAL_THEMES` 固定色板继续服务
 *   「零装饰 legacy」与「参考多色保真」分支，避免既有视觉完整性快照回归。
 */

export interface DerivedDecorColors {
  /** 规范化的主色 hex（保留输入大小写，与内容层主色逐字一致）。 */
  main: string;
  /** 低透明度主色，用于结论条底色 / 母题渐变末端。 */
  soft: string;
  /** 右上光斑。 */
  glowA: string;
  /** 左下光斑。 */
  glowB: string;
  /** 统一页眉装饰线。 */
  accent: string;
  /** 画布表面色与极淡主色底，替代固定主题的暖色渐变。 */
  surface: string;
  canvasBg: string;
}

function parseHex(hex: string): [string, number, number, number] | undefined {
  const raw = String(hex).trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return undefined;
  return [
    `#${raw}`,
    parseInt(raw.slice(0, 2), 16),
    parseInt(raw.slice(2, 4), 16),
    parseInt(raw.slice(4, 6), 16),
  ];
}

/** 解析失败返回 undefined，调用方自动回落到固定主题色板。 */
export function deriveDecorColors(primary?: string): DerivedDecorColors | undefined {
  const parsed = parseHex(primary ?? '');
  if (!parsed) return undefined;
  const [main, r, g, b] = parsed;
  return {
    main,
    soft: `rgba(${r},${g},${b},0.10)`,
    glowA: `rgba(${r},${g},${b},0.16)`,
    glowB: `rgba(${r},${g},${b},0.10)`,
    accent: main,
    surface: '#FFFFFF',
    canvasBg: `rgba(${r},${g},${b},0.04)`,
  };
}
