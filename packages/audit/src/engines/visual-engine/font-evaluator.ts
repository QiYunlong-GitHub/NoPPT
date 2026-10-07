export const FONT_ICON_EVALUATOR = `(({ declaredFamily, weight }) => {
  const visible = Array.from(document.body.querySelectorAll("*"));
  const fontFamilies = new Set();
  const fontSizes = new Set();
  const iconStyles = new Set();
  const firstText = visible.find((element) => {
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && (element.textContent || "").trim();
  });
  const firstStyle = firstText ? getComputedStyle(firstText) : null;
  const family = declaredFamily || (firstStyle && firstStyle.fontFamily) || "system-ui";
  const fonts = document.fonts;
  const fontsApiAvailable = Boolean(fonts && typeof fonts.check === "function");
  const fontChecks = {};
  if (fontsApiAvailable) fontChecks[String(weight || (firstStyle && firstStyle.fontWeight) || 400)] = fonts.check(String(weight || 400) + " 16px " + family, "BESbswy");
  const fontCheck = fontsApiAvailable ? Object.values(fontChecks).every(Boolean) : undefined;
  const style = firstStyle;
  const resolvedFamily = style ? (style.fontFamily || "").split(",")[0].trim().replace(/["']/g, "") : "";
  const fontSize = style ? parseFloat(style.fontSize) : undefined;
  const lineHeight = style && style.lineHeight !== "normal" ? parseFloat(style.lineHeight) : undefined;
  let canvasWidthDelta = 0;
  if (firstText && style && Number.isFinite(fontSize)) {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (context) {
      const text = (firstText.textContent || "").trim().slice(0, 500);
      context.font = String(weight || style.fontWeight) + " " + fontSize + "px " + family;
      const declaredWidth = context.measureText(text).width;
      context.font = style.fontWeight + " " + fontSize + "px " + style.fontFamily;
      const resolvedWidth = context.measureText(text).width;
      canvasWidthDelta = Math.abs(resolvedWidth - declaredWidth) / Math.max(declaredWidth, 1);
    }
  }
  visible.forEach((element) => {
    const current = getComputedStyle(element);
    if (current.display === "none" || current.visibility === "hidden") return;
    const currentFamily = (current.fontFamily || "").split(",")[0].trim().replace(/["']/g, "");
    if (currentFamily) fontFamilies.add(currentFamily);
    const size = parseFloat(current.fontSize);
    if (Number.isFinite(size)) fontSizes.add(Math.round(size * 10) / 10);
    const classNames = typeof element.className === "string" ? element.className : "";
    const isSvg = element.tagName.toLowerCase() === "svg";
    if (isSvg || element.hasAttribute("data-icon") || /(^|[\\s-])icon(s)?([\\s-]|$)/i.test(classNames)) iconStyles.add(element.getAttribute("data-icon-style") || (isSvg ? "linear" : "solid"));
  });
  return {
    fontFamilies: Array.from(fontFamilies),
    fontSizes: Array.from(fontSizes).sort((a, b) => a - b),
    iconStyles: Array.from(iconStyles),
    observation: {
      fontsApiAvailable, fontCheck, fontChecks, resolvedFamily,
      resolvedWeight: style ? style.fontWeight : undefined,
      fontSize, lineHeight,
      baselineWidth: firstText ? firstText.clientWidth : undefined,
      baselineHeight: firstText ? firstText.clientHeight : undefined,
      scrollWidth: firstText ? firstText.scrollWidth : undefined,
      clientWidth: firstText ? firstText.clientWidth : undefined,
      scrollHeight: firstText ? firstText.scrollHeight : undefined,
      clientHeight: firstText ? firstText.clientHeight : undefined,
      canvasWidthDelta, canvasHeightDelta: 0
    },
    layoutProfile: document.documentElement.getAttribute("data-layout-profile") || document.body.getAttribute("data-layout-profile") || undefined
  };
})`;
