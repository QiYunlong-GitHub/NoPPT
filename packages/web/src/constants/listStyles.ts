export const BULLET_STYLES: Record<string, { symbol: string; label: string }> = {
  disc: { symbol: '●', label: '实心圆点' },
  circle: { symbol: '○', label: '空心圆点' },
  square: { symbol: '■', label: '实心方块' },
  'square-open': { symbol: '□', label: '空心方块' },
  diamond: { symbol: '◆', label: '实心菱形' },
  'diamond-open': { symbol: '◇', label: '空心菱形' },
  triangle: { symbol: '▲', label: '三角' },
  'triangle-open': { symbol: '△', label: '空心三角' },
  arrow: { symbol: '➤', label: '箭头' },
  check: { symbol: '✓', label: '对勾' },
  star: { symbol: '★', label: '星形' },
  dash: { symbol: '—', label: '横线' },
  none: { symbol: '', label: '无' },
};

export const NUMBER_STYLES: Record<string, { formatter: (index: number) => string; label: string }> = {
  decimal: { formatter: (i) => `${i}.`, label: '1. 2. 3.' },
  'decimal-leading-zero': { formatter: (i) => `${i.toString().padStart(2, '0')}.`, label: '01. 02.' },
  'upper-roman': { formatter: (i) => toRoman(i) + '.', label: 'I. II. III.' },
  'lower-roman': { formatter: (i) => toRoman(i).toLowerCase() + '.', label: 'i. ii. iii.' },
  'upper-alpha': { formatter: (i) => `${String.fromCharCode(64 + i)}.`, label: 'A. B. C.' },
  'lower-alpha': { formatter: (i) => `${String.fromCharCode(96 + i)}.`, label: 'a. b. c.' },
  'upper-alpha-paren': { formatter: (i) => `${String.fromCharCode(64 + i)})`, label: 'A) B) C)' },
  'decimal-paren': { formatter: (i) => `${i})`, label: '1) 2) 3)' },
  'circled-number': { formatter: (i) => circledNumber(i), label: '① ② ③' },
  none: { formatter: () => '', label: '无' },
};

function circledNumber(num: number): string {
  if (num <= 0) return String(num);
  if (num <= 20) return String.fromCharCode(0x2460 + num - 1);
  if (num <= 35) return String.fromCharCode(0x3251 + num - 21);
  return String(num);
}

function toRoman(num: number): string {
  const romanNumerals: [number, string][] = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
    [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let result = '';
  for (const [value, symbol] of romanNumerals) {
    while (num >= value) {
      result += symbol;
      num -= value;
    }
  }
  return result;
}

export const LIST_INDENT = '  ';
