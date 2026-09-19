import type { ReactNode } from 'react';
import { Zap, Target, Users } from 'lucide-react';
import { t } from '@/i18n';
import type { CollabMode, ColorTheme, FontFamily } from './types';
import type { IconStyle } from '@noppt/ai';

// 以下常量原为 AIGenerateModal.tsx 的内联选项数据，现外置为本模块，
// 仅做代码搬移，不改变任何取值 / 顺序 / 映射（对应 options.test.ts 行为锁定）。

export const COLOR_THEME_IDS = ['blue', 'purple', 'green', 'orange', 'teal', 'gray'] as const;

export const ICON_STYLE_IDS = [
  'auto',
  'line',
  'filled',
  'numbered',
  'bullet',
  'lettered',
  'emoji',
  'none',
] as const;

export const audienceOptions: {
  id: string;
  name: string;
  desc: string;
}[] = [
  { id: '通用商务受众', name: '通用商务', desc: t('跨行业通用') },
  { id: '技术研发团队 / 工程师', name: '技术人员', desc: t('工程师/研发') },
  { id: '公司管理层 / 决策者', name: '管理层', desc: t('老板/总监') },
  { id: '投资人 / 股东', name: '投资人', desc: t('融资/路演') },
  { id: '学生 / 教育场景', name: '学生/教育', desc: t('课堂/作业') },
  { id: '销售市场团队 / 客户', name: '销售市场', desc: t('营销/提案') },
];

export const fontFamilyOptions: {
  id: FontFamily;
  name: string;
  desc: string;
}[] = [
  { id: 'sans', name: '无衬线体', desc: t('现代商务风（推荐）') },
  { id: 'serif', name: '衬线体', desc: t('典雅学术风') },
  { id: 'mono', name: '等宽体', desc: t('技术极客风') },
];

export const colorThemeOptions: {
  id: ColorTheme;
  name: string;
  color: string;
}[] = [
  { id: 'blue', name: '商务蓝', color: '#2563eb' },
  { id: 'purple', name: '创意紫', color: '#7c3aed' },
  { id: 'teal', name: '科技青', color: '#0891b2' },
  { id: 'green', name: '自然绿', color: '#059669' },
  { id: 'orange', name: '活力橙', color: '#ea580c' },
  { id: 'gray', name: '极简灰', color: '#4b5563' },
];

export const iconStyleOptions: {
  id: IconStyle;
  name: string;
  desc: string;
}[] = [
  { id: 'auto', name: '智能匹配', desc: t('默认线性，专业简约') },
  { id: 'line', name: '线性图标', desc: t('描边风格，B端/技术首选') },
  { id: 'filled', name: '面性图标', desc: t('实心填充，重点/封面') },
  { id: 'numbered', name: '数字序号', desc: '1 2 3 4' },
  { id: 'bullet', name: '对勾/圆点', desc: '✓ ● ✓ ●' },
  { id: 'lettered', name: '字母分类', desc: 'A B C D' },
  { id: 'emoji', name: 'Emoji', desc: t('🎯 📊 ⚡ 💡') },
  { id: 'none', name: '无图标', desc: t('纯文字') },
];

export function getPageTypeLabel(pageType: string): string {
  if (pageType === 'cover') return t('封面');
  if (pageType === 'toc') return t('目录');
  if (pageType.startsWith('content-')) return t('内容');
  if (pageType === 'summary' || pageType === 'conclusion') return t('总结');
  return t('页面');
}

export const modeOptions: {
  id: CollabMode;
  icon: ReactNode;
  title: string;
  desc: string;
  badge?: string;
}[] = [
  {
    id: 'auto',
    icon: <Zap className="w-5 h-5" />,
    title: t('全自动'),
    desc: t('一键生成，最快出稿'),
  },
  {
    id: 'guided',
    icon: <Target className="w-5 h-5" />,
    title: t('引导式'),
    desc: t('关键节点确认，防返工'),
    badge: '推荐',
  },
  {
    id: 'collaborative',
    icon: <Users className="w-5 h-5" />,
    title: t('协作式'),
    desc: t('逐页审核，精雕细琢'),
  },
];

export const styles = [
  { id: 'business', name: '商务风', desc: t('专业正式') },
  { id: 'creative', name: '创意风', desc: t('活泼有趣') },
  { id: 'simple', name: '简约风', desc: t('简洁明了') },
  { id: 'academic', name: '学术风', desc: t('严谨专业') },
];
