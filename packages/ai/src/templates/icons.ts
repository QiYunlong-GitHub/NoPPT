import { renderSvgIcon, type SemanticIconKey } from './svg-icons';

const SEMANTIC_ICON_SEQUENCE: SemanticIconKey[] = [
  'target',
  'code',
  'zap',
  'shield',
  'bulb',
  'users',
  'rocket',
  'chart',
  'layers',
  'cloud',
  'database',
  'tool',
  'globe',
  'search',
  'sparkle',
  'key',
  'cpu',
  'branch',
  'package',
  'terminal',
  'check',
  'settings',
  'eye',
  'clock',
];

function getSemanticIconByIndex(idx: number): SemanticIconKey {
  return SEMANTIC_ICON_SEQUENCE[idx % SEMANTIC_ICON_SEQUENCE.length];
}

function getIcons(iconStyle: string, idx: number, primary: string, darker: string): string {
  const grad = `linear-gradient(135deg,${primary},${darker})`;
  const shadow = `0 2px 8px ${primary}40`;
  const letter = String.fromCharCode(65 + (idx % 26));

  // Emoji池，按索引循环使用
  const emojiPool = [
    '🎯',
    '📊',
    '⚡',
    '🛡️',
    '💡',
    '🤝',
    '🚀',
    '📈',
    '🔍',
    '✨',
    '🔥',
    '⭐',
    '🏆',
    '🎨',
    '💎',
    '🌐',
    '🔑',
    '📱',
    '💻',
    '🔧',
  ];
  const emoji = emojiPool[idx % emojiPool.length];

  switch (iconStyle) {
    case 'line': {
      // 线性（描边）图标：Lucide 风格，主色描边，无背景，轻量化
      const key = getSemanticIconByIndex(idx);
      return `<span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:28px;height:28px;border-radius:8px;background:${primary}10;color:${primary};">${renderSvgIcon(key, 'line', 18, primary, 2)}</span>`;
    }
    case 'filled': {
      // 面性（填充）图标：实心色块，主色填充，视觉权重高
      const key = getSemanticIconByIndex(idx);
      return `<span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:28px;height:28px;border-radius:8px;background:${grad};box-shadow:${shadow};color:#fff;">${renderSvgIcon(key, 'filled', 18, '#fff', 0)}</span>`;
    }
    case 'numbered':
      return `<span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:28px;height:28px;border-radius:8px;background:${grad};box-shadow:${shadow};color:#fff;font-size:14px;font-weight:800;">${idx + 1}</span>`;
    case 'checkmark': // 兼容旧值
    case 'bullet': {
      // 对勾样式（bullet默认对勾，AI可在生成时自行切换圆点）
      return `<span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:28px;height:28px;border-radius:50%;background:${grad};box-shadow:${shadow};"><svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M13 4L6.5 10.5L3 7" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
    }
    case 'lettered':
      return `<span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:28px;height:28px;border-radius:50%;background:${grad};box-shadow:${shadow};color:#fff;font-size:13px;font-weight:800;">${letter}</span>`;
    case 'minimal': // 兼容旧值
      return `<span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:10px;height:10px;border-radius:50%;background:${primary};"></span>`;
    case 'emoji': {
      // 交替使用纯emoji和圆角矩形背景emoji，让模板效果更丰富
      const useBg = idx % 2 === 1;
      if (useBg) {
        const radius = idx % 4 === 1 ? '10px' : '50%'; // 交替圆角矩形和圆形
        return `<span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:40px;height:40px;border-radius:${radius};background:${primary}12;font-size:20px;line-height:1;">${emoji}</span>`;
      }
      return `<span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:32px;height:28px;font-size:22px;line-height:1;">${emoji}</span>`;
    }
    case 'none':
      return '';
    case 'auto':
    default:
      // auto 默认使用线性图标（B 端技术场景最安全、最专业的选择）
      const key = getSemanticIconByIndex(idx);
      return `<span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:28px;height:28px;border-radius:8px;background:${primary}10;color:${primary};">${renderSvgIcon(key, 'line', 18, primary, 2)}</span>`;
  }
}

/**
 * 生成emoji大图标（用于卡片顶部/目录/时间轴的emoji版本）
 * @param size 容器尺寸
 * @param emojiSize emoji字体大小
 * @param idx 索引（用于从池中取emoji并决定背景形状）
 * @param primary 主色
 */
function getEmojiBigIcon(size: number, emojiSize: number, idx: number, primary: string): string {
  const emojiPool = [
    '🎯',
    '📊',
    '⚡',
    '🛡️',
    '💡',
    '🤝',
    '🚀',
    '📈',
    '🔍',
    '✨',
    '🔥',
    '⭐',
    '🏆',
    '🎨',
    '💎',
    '🌐',
    '🔑',
    '📱',
    '💻',
    '🔧',
  ];
  const emoji = emojiPool[idx % emojiPool.length];
  // 大图标默认使用圆角矩形背景
  const radius = Math.round(size / 4);
  return `<span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:${size}px;height:${size}px;border-radius:${radius}px;background:${primary}12;font-size:${emojiSize}px;line-height:1;">${emoji}</span>`;
}

/**
 * 生成纯emoji图标（无背景版本，用于标题前点缀等）
 */
function getCircleIcon(
  size: number,
  fontSize: number,
  num: number,
  primary: string,
  darker: string,
): string {
  const fontWeight = 800;
  const shadowAlpha = '35';
  const grad = `linear-gradient(135deg,${primary},${darker})`;
  const shadow = `0 ${size > 44 ? 4 : 3}px ${size > 44 ? 16 : 12}px ${primary}${shadowAlpha}`;
  return `<span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:${size}px;height:${size}px;border-radius:50%;background:${grad};box-shadow:${shadow};color:#fff;font-size:${fontSize}px;font-weight:${fontWeight};">${num}</span>`;
}

function getCompareRightIcon(primary: string, darker: string): string {
  const grad = `linear-gradient(135deg,${primary},${darker})`;
  const shadow = `0 2px 8px ${primary}40`;
  return `<span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:28px;height:28px;border-radius:50%;background:${grad};box-shadow:${shadow};"><svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M13 4L6.5 10.5L3 7" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
}

function getCompareLeftIcon(): string {
  return `<span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:20px;height:20px;border-radius:50%;background:#E5E7EB;"><svg width="10" height="10" viewBox="0 0 10 10"><rect x="2" y="4.5" width="6" height="1.5" rx="0.75" fill="#9CA3AF"/></svg></span>`;
}

function buildLi(icon: string, text: string): string {
  if (!icon) {
    return `<li style="overflow-wrap:break-word;word-break:break-word;">${text}</li>`;
  }
  return `<li style="display:flex;align-items:center;gap:16px;overflow-wrap:break-word;word-break:break-word;">${icon}<span style="line-height:1.4;flex:1;">${text}</span></li>`;
}


export { SEMANTIC_ICON_SEQUENCE, getSemanticIconByIndex, getIcons, getEmojiBigIcon, getCircleIcon, getCompareRightIcon, getCompareLeftIcon, buildLi };
