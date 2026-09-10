export function readStyleValue(el: HTMLElement, key: string): string {
  const inlineValue = (el.style as unknown as Record<string, string>)[key];
  if (inlineValue) {
    return inlineValue;
  }
  const computed = window.getComputedStyle(el);
  const computedValue = (computed as unknown as Record<string, string>)[key];
  if (computedValue && computedValue !== 'none') {
    return computedValue;
  }
  return inlineValue || computedValue || '';
}

export function writeStyleValue(el: HTMLElement, key: string, value: string): void {
  (el.style as unknown as Record<string, string>)[key] = value;
}

export function parseNumberValue(value: string, unit: string): number {
  if (!value) return 0;
  const trimmed = value.trim();
  if (unit) {
    const escaped = unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = trimmed.match(new RegExp(`^(-?\\d+(?:\\.\\d+)?)${escaped}$`));
    if (match) {
      return parseFloat(match[1]);
    }
  }
  const num = parseFloat(trimmed);
  return isNaN(num) ? 0 : num;
}

export function formatNumberValue(num: number, unit: string): string {
  return `${num}${unit}`;
}
