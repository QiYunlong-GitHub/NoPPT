/**
 * PostProcess 字体栈簇（从 html-presentation-agent.ts 外置）。
 * 纯函数；依赖的 DEFAULT_HARDCODED_* 常量由调用方（agent 实例）作为参数传入，保持无 this 依赖。
 */

export function normalizeFontName(name: string): string {
  return name.replace(/\s+/g, '').replace(/["';]/g, '').toLowerCase();
}

export function isDefaultSansPlaceholder(current: string, defaultSans: string): boolean {
  if (!current) return false;
  const cleaned = current.trim().replace(/;+$/g, '');
  if (!cleaned) return false;
  const normalizeName = (s: string) => normalizeFontName(s);
  const currentParts = cleaned.split(',').map(normalizeName).filter(Boolean);
  if (currentParts.length === 0) return false;
  const defaultSansNames = new Set(
    defaultSans.split(',').map(normalizeName).filter(Boolean),
  );
  return currentParts.every((p) => defaultSansNames.has(p));
}

export function isDefaultLegacyMonoPlaceholder(current: string, legacyMono: string): boolean {
  if (!current) return false;
  const cleaned = current.trim().replace(/;+$/g, '');
  if (!cleaned) return false;
  const normalizeName = (s: string) => normalizeFontName(s);
  const currentParts = cleaned.split(',').map(normalizeName).filter(Boolean);
  if (currentParts.length === 0) return false;
  if (currentParts.length < 5) return false;
  const legacyMonoNames = new Set(
    legacyMono.split(',').map(normalizeName).filter(Boolean),
  );
  return currentParts.every((p) => legacyMonoNames.has(p));
}

export function isPlaceholderFontFamily(
  current: string,
  defaultSans: string = "system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif",
  legacyMono: string = "'JetBrains Mono', ui-monospace, 'Cascadia Code', Consolas, 'Noto Sans Mono CJK SC', monospace",
): boolean {
  return (
    isDefaultSansPlaceholder(current, defaultSans) ||
    isDefaultLegacyMonoPlaceholder(current, legacyMono)
  );
}

export function getFontStack(fontFamily: 'sans' | 'serif' | 'mono' = 'sans'): string {
  switch (fontFamily) {
    case 'serif':
      return "Georgia, 'Times New Roman', 'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'Songti SC', serif";
    // NOTE: FONT_STACK_MONO —— 若修改请同步：
    //   - ai: packages/ai/src/agents/html-presentation-agent.ts#getFontStack('mono')
    //   - templates: packages/ai/src/templates/generate-html-presentation.ts#getFontStackLocal('mono')
    //   - web: packages/web/src/components/AIGenerateModal.tsx 的 mono 预览 style
    //   目的：为 CJK 字符在 Windows 下回退时命中微软雅黑(PingFangSC)而不是 SimSun(衬线宋)。
    case 'mono':
      return "'JetBrains Mono', ui-monospace, 'Cascadia Code', Consolas, 'PingFang SC', 'Microsoft YaHei', '微软雅黑', 'Noto Sans SC', 'Noto Sans Mono CJK SC', monospace";
    case 'sans':
    default:
      return "system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif";
  }
}
