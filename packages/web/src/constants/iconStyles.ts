import type { LucideIcon } from 'lucide-react';
import { Sparkles, Hash, Type, List, Smile, Minus, PenTool, Square } from 'lucide-react';

export interface IconStyleOption {
  id: 'auto' | 'line' | 'filled' | 'numbered' | 'bullet' | 'lettered' | 'emoji' | 'none' | string;
  name: string;
  icon: LucideIcon;
  desc: string;
}

export const ICON_STYLE_OPTIONS: IconStyleOption[] = [
  { id: 'auto', name: '智能匹配', icon: Sparkles, desc: '默认线性，专业简约' },
  { id: 'line', name: '线性图标', icon: PenTool, desc: '描边风格，B端/技术首选' },
  { id: 'filled', name: '面性图标', icon: Square, desc: '实心填充，重点/封面' },
  { id: 'numbered', name: '数字序号', icon: Hash, desc: '1 2 3 4' },
  { id: 'bullet', name: '对勾/圆点', icon: List, desc: '✓ ● ✓ ●' },
  { id: 'lettered', name: '字母分类', icon: Type, desc: 'A B C D' },
  { id: 'emoji', name: 'Emoji', icon: Smile, desc: '🎯 📊 ⚡ 💡' },
  { id: 'none', name: '无图标', icon: Minus, desc: '纯文字' },
];
