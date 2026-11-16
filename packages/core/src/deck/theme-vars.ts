/**
 * 阶段 5：展示层主题 CSS 变量契约。
 *
 * HTML 内容由确定性 Deck 渲染器以内联样式生成，这些变量只作用于舞台外壳与画布外围，
 * 让编辑器、预览页、MCP 舞台三端使用同一套语义；各处都必须写 `var(..., 兜底值)`，
 * 保证未注入变量时仍是历史白底行为。
 *
 * 前后端 `sanitizeStyleString` 已放行 `--*` 自定义属性（阶段 4），因此变量可安全穿过清洗链。
 */

export const NOPPT_THEME_VARS = {
  stageBg: '--noppt-stage-bg',
  surface: '--noppt-surface',
  primary: '--noppt-theme-primary',
  text: '--noppt-theme-text',
  border: '--noppt-theme-border',
} as const;

/** 默认主题（与 `packages/ai/.../deck/visual-tokens.ts` 的 blue 色板对齐）。 */
export const DEFAULT_THEME_VARS: Record<string, string> = {
  [NOPPT_THEME_VARS.stageBg]: '#f5f7fb',
  [NOPPT_THEME_VARS.surface]: '#ffffff',
  [NOPPT_THEME_VARS.primary]: '#2563eb',
  [NOPPT_THEME_VARS.text]: '#0f172a',
  [NOPPT_THEME_VARS.border]: '#e3e8ef',
};

/** 转成可拼进 style 属性或 `:root{}` 的声明串。 */
export function themeVarsToCss(vars: Record<string, string> = DEFAULT_THEME_VARS): string {
  return Object.entries(vars)
    .map(([key, value]) => `${key}:${value}`)
    .join(';');
}

function hueOf(hex: string): number | undefined {
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

/** 由最终主色派生展示层 CSS 变量，保证编辑器/预览/MCP 舞台与主色一致。 */
export function themeVarsForPrimary(primary?: string): Record<string, string> {
  const hue = hueOf(primary ?? '');
  const palette: Record<string, string> =
    hue === undefined
      ? {}
      : hue >= 85 && hue < 170
        ? { [NOPPT_THEME_VARS.stageBg]: '#f2f8f3', [NOPPT_THEME_VARS.border]: '#dceadf' }
        : hue >= 170 && hue < 255
          ? { [NOPPT_THEME_VARS.stageBg]: '#f5f7fb', [NOPPT_THEME_VARS.border]: '#e3e8ef' }
          : { [NOPPT_THEME_VARS.stageBg]: '#fbf7f0', [NOPPT_THEME_VARS.border]: '#eee2cf' };
  const valid = primary && /^#[0-9a-fA-F]{6}$/.test(primary) ? primary.toLowerCase() : undefined;
  return {
    ...DEFAULT_THEME_VARS,
    ...palette,
    [NOPPT_THEME_VARS.primary]: valid ?? DEFAULT_THEME_VARS[NOPPT_THEME_VARS.primary],
  };
}
