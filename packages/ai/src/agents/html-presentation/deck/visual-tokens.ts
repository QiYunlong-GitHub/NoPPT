/**
 * 可移植设计 token —— 从 `GoodSamplePPT/` 6 个案例提炼的数值，落在 16:9 分页渲染器上。
 *
 * 来源见 `repo-wiki/slide-visual-gap-analysis-and-plan.md` §5.2。
 * 约束：不引入 CDN / 外部字体服务 / 图表库；所有值最终以内联 style 输出，
 * 因为 `packages/core/src/security/html-allowlist.ts` 不允许 `<style>` 与 `<link>`。
 *
 * 本模块是纯常量 + 纯函数，不改变任何既有导出契约；主题通过 `DeckToHtmlOptions.visualTheme`
 * opt-in，默认（不传）路径保持零装饰，避免影响既有 Deck↔HTML parity 与视觉完整性快照。
 */

export type VisualThemeId = 'blue' | 'warm' | 'nature';

export interface VisualPalette {
  blue: string;
  teal: string;
  amber: string;
  rose: string;
  violet: string;
  softBlue: string;
  softTeal: string;
  softAmber: string;
  softRose: string;
  softViolet: string;
}

export interface VisualTheme {
  id: VisualThemeId;
  palette: VisualPalette;
  canvasBg: string;
  surface: string;
  border: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  /** 正文无衬线栈 / 标题衬线栈（均不含双引号，见 `fontFamilyCss`）。 */
  fontBody: string;
  fontHeading: string;
  shadows: { sm: string; md: string; lg: string };
  radii: { sm: number; md: number; lg: number; pill: number };
  /** 16:9 画布字号层级（px）。 */
  fontSize: { cover: number; section: number; kpi: number; card: number; label: number };
  /** 封面两层 radial 光斑颜色。 */
  glowA: string;
  glowB: string;
  /** SVG 装饰主色。 */
  svgAccent: string;
}

const FONT_BODY = "'Noto Sans SC','PingFang SC','Microsoft YaHei',system-ui,sans-serif";
const FONT_HEADING = "'Noto Serif SC','Songti SC','SimSun',serif";

const SHADOWS = {
  sm: '0 1px 3px rgba(15,23,42,0.06)',
  md: '0 4px 16px rgba(15,23,42,0.06)',
  lg: '0 12px 32px rgba(15,23,42,0.08)',
};

const RADII = { sm: 10, md: 14, lg: 20, pill: 999 };

const FONT_SIZE = { cover: 64, section: 40, kpi: 30, card: 18, label: 13 };

const BLUE: VisualTheme = {
  id: 'blue',
  palette: {
    blue: '#2563eb',
    teal: '#0d9488',
    amber: '#d97706',
    rose: '#e11d48',
    violet: '#7c3aed',
    softBlue: '#eff6ff',
    softTeal: '#f0fdfa',
    softAmber: '#fffbeb',
    softRose: '#fff1f2',
    softViolet: '#f5f3ff',
  },
  canvasBg: '#f5f7fb',
  surface: '#ffffff',
  border: '#e3e8ef',
  text: '#0f172a',
  textSecondary: '#475569',
  textMuted: '#94a3b8',
  fontBody: FONT_BODY,
  fontHeading: FONT_HEADING,
  shadows: SHADOWS,
  radii: RADII,
  fontSize: FONT_SIZE,
  glowA: '#dbeafe',
  glowB: '#ccfbf1',
  svgAccent: '#93c5fd',
};

const WARM: VisualTheme = {
  ...BLUE,
  id: 'warm',
  palette: {
    blue: '#3b82f6',
    teal: '#14b8a6',
    amber: '#f59e0b',
    rose: '#f43f5e',
    violet: '#a855f7',
    softBlue: '#eff6ff',
    softTeal: '#f0fdfa',
    softAmber: '#fef3c7',
    softRose: '#ffe4e6',
    softViolet: '#fae8ff',
  },
  canvasBg: '#fbf7f0',
  glowA: '#fde68a',
  glowB: '#fecaca',
  svgAccent: '#fcd34d',
};

const NATURE: VisualTheme = {
  ...BLUE,
  id: 'nature',
  palette: {
    blue: '#4c9a6b',
    teal: '#48a999',
    amber: '#e0a458',
    rose: '#d97757',
    violet: '#7b8f6a',
    softBlue: '#eef7f0',
    softTeal: '#eaf7f4',
    softAmber: '#fdf3e3',
    softRose: '#fbede8',
    softViolet: '#f0f4ea',
  },
  canvasBg: '#f2f8f3',
  glowA: '#cfe9d1',
  glowB: '#f7e6bd',
  svgAccent: '#8ec79c',
};

/** 三套可切换色板（分析文档 §6.3 验收：≥3 套）。 */
export const VISUAL_THEMES: Record<VisualThemeId, VisualTheme> = {
  blue: BLUE,
  warm: WARM,
  nature: NATURE,
};

/** 生产路径默认主题；显式传 `undefined` 表示保持零装饰的 legacy 输出。 */
export const DEFAULT_VISUAL_THEME: VisualThemeId = 'blue';

/** 解析主题 id；未知 id 回落默认，未传则返回 undefined（零装饰）。 */
export function resolveVisualTheme(id?: string): VisualTheme | undefined {
  if (!id) return undefined;
  return VISUAL_THEMES[id as VisualThemeId] ?? VISUAL_THEMES[DEFAULT_VISUAL_THEME];
}

function primaryHue(hex: string): number | undefined {
  const h = (hex || '').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return undefined;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return undefined;
  let hue = 0;
  if (max === r) hue = ((g - b) / d) % 6;
  else if (max === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  hue *= 60;
  return hue < 0 ? hue + 360 : hue;
}

/** 由最终主色派生视觉主题，避免 6 色 UI 枚举都落回固定 blue。 */
export function resolveVisualThemeIdForPrimary(primary?: string): VisualThemeId {
  const hue = primaryHue(primary ?? '');
  if (hue === undefined) return DEFAULT_VISUAL_THEME;
  if (hue >= 85 && hue < 170) return 'nature';
  if (hue >= 170 && hue < 255) return 'blue';
  return 'warm';
}

/** 语义色板中允许出现在 HTML 里的十六进制色值（供阶段 4 后处理白名单复用）。 */
export function semanticPaletteHexes(theme: VisualTheme): string[] {
  const { palette } = theme;
  return [
    palette.blue,
    palette.teal,
    palette.amber,
    palette.rose,
    palette.violet,
    palette.softBlue,
    palette.softTeal,
    palette.softAmber,
    palette.softRose,
    palette.softViolet,
    theme.canvasBg,
    theme.surface,
    theme.border,
    theme.text,
    theme.textSecondary,
  ];
}
