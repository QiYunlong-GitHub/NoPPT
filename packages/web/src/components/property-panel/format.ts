/**
 * PropertyPanel 的字体与颜色格式化工具（由 PropertyPanel.tsx 逐字节搬移）。
 * 均为纯函数，可独立测试。
 */
import { t } from '@/i18n';

export const FONT_LIST = [
  { value: 'Microsoft YaHei, 微软雅黑, sans-serif', label: t('微软雅黑') },
  { value: 'SimSun, 宋体, serif', label: t('宋体') },
  { value: 'SimHei, 黑体, sans-serif', label: t('黑体') },
  { value: 'KaiTi, 楷体, serif', label: t('楷体') },
  { value: 'FangSong, 仿宋, serif', label: t('仿宋') },
  { value: 'NSimSun, 新宋体, serif', label: t('新宋体') },
  { value: 'Arial, sans-serif', label: 'Arial' },
  { value: '"Times New Roman", serif', label: 'Times New Roman' },
  { value: '"Courier New", monospace', label: 'Courier New' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: 'Verdana, sans-serif', label: 'Verdana' },
  { value: 'system-ui, sans-serif', label: t('系统默认') },
];
export const matchFontFamily = (computedFont: string): string => {
  if (!computedFont) return '';
  const lowerFont = computedFont.toLowerCase().replace(/['"]/g, '');
  for (const font of FONT_LIST) {
    const firstFont = font.value.split(',')[0].trim().toLowerCase().replace(/['"]/g, '');
    if (lowerFont.includes(firstFont)) {
      return font.value;
    }
  }
  return computedFont;
};
export function rgbToHex(rgb: string): string {
  if (rgb.startsWith('#')) return rgb;
  const match = rgb.match(/\d+/g);
  if (!match || match.length < 3) return '#000000';
  const r = parseInt(match[0]).toString(16).padStart(2, '0');
  const g = parseInt(match[1]).toString(16).padStart(2, '0');
  const b = parseInt(match[2]).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}
