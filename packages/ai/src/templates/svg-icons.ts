/**
 * 语义化 SVG 图标库（统一入口）
 *
 * 数据来源：
 * - 线性图标（line）：Lucide Static（1400+ 开源 ISC 协议图标，https://lucide.dev）
 *   运行时从 lucide-static 包按名称解析 SVG 字符串，支持任意 Lucide 图标名。
 * - 面性图标（filled）：内嵌 Heroicons Solid 风格路径（精选常用语义图标），
 *   当请求面性图标且内嵌库未命中时，使用同名 Lucide 线性图标作为兜底。
 * - Emoji：由调用方自行处理，不在本模块。
 *
 * 解析优先级（resolveIconName）：
 *   1. 显式图标名称（AI 可直接指定 Lucide 图标名，如 "rocket"、"cloud-cog"）
 *   2. 语义关键词匹配（中英文关键词 → 图标名）
 *   3. 按索引循环精选图标列表
 *   4. 兜底默认图标（"check"）
 *
 * 向后兼容：保留 SemanticIconKey 联合类型及 renderSvgIcon/renderBadgeIcon/
 * renderSemanticIconByIndex/guessIconKey 等原有 API，内部实现切换到新解析器。
 */

import {
  resolveIcon as resolveIconFromRegistry,
  resolveIconByName,
  resolveIconByText,
  resolveIconByIndex,
  getLucideSvgRaw,
  extractLucideInner,
  CURATED_ICONS,
  type IconEntry,
} from './icon-registry';

export type { IconEntry };
export { CURATED_ICONS, resolveIconByName, resolveIconByText, resolveIconByIndex };

export type SemanticIconKey =
  | 'target' | 'chart' | 'zap' | 'shield' | 'bulb' | 'users'
  | 'rocket' | 'trending' | 'search' | 'sparkle' | 'fire' | 'trophy'
  | 'palette' | 'diamond' | 'globe' | 'key' | 'device' | 'code'
  | 'tool' | 'clock' | 'check' | 'warning' | 'bell' | 'lock'
  | 'cloud' | 'database' | 'layers' | 'branch' | 'cpu' | 'package'
  | 'terminal' | 'heart' | 'flag' | 'book' | 'calendar' | 'chat'
  | 'eye' | 'settings' | 'arrow-right' | 'star';

const LEGACY_KEY_MAP: Record<SemanticIconKey, string> = {
  target: 'target',
  chart: 'bar-chart-3',
  zap: 'zap',
  shield: 'shield-check',
  bulb: 'lightbulb',
  users: 'users',
  rocket: 'rocket',
  trending: 'trending-up',
  search: 'search',
  sparkle: 'sparkles',
  fire: 'flame',
  trophy: 'trophy',
  palette: 'palette',
  diamond: 'gem',
  globe: 'globe',
  key: 'key',
  device: 'smartphone',
  code: 'code',
  tool: 'wrench',
  clock: 'clock',
  check: 'check-circle-2',
  warning: 'alert-triangle',
  bell: 'bell',
  lock: 'lock',
  cloud: 'cloud',
  database: 'database',
  layers: 'layers',
  branch: 'git-branch',
  cpu: 'cpu',
  package: 'package',
  terminal: 'terminal',
  heart: 'heart',
  flag: 'flag',
  book: 'book-open',
  calendar: 'calendar',
  chat: 'message-square',
  eye: 'eye',
  settings: 'settings',
  'arrow-right': 'arrow-right',
  star: 'star',
};

const FILLED_ICONS: Record<string, string> = {
  target: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 16a6 6 0 1 1 0-12 6 6 0 0 1 0 12zm0-9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/>',
  code: '<path d="M9.4 16.6 4.8 12l4.6-4.6a1 1 0 1 0-1.4-1.4l-5.4 5.4a1 1 0 0 0 0 1.4l5.4 5.4a1 1 0 0 0 1.4-1.4zm5.2 0 4.6-4.6-4.6-4.6a1 1 0 1 1 1.4-1.4l5.4 5.4a1 1 0 0 1 0 1.4l-5.4 5.4a1 1 0 0 1-1.4-1.4z"/>',
  terminal: '<path d="M3 3h18a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm1.3 4.3a1 1 0 0 0-1.4 1.4L5.6 11l-2.7 2.3a1 1 0 1 0 1.4 1.4l3.5-3a1 1 0 0 0 0-1.4l-3.5-3zM12 16h6a1 1 0 0 0 0-2h-6a1 1 0 0 0 0 2z"/>',
  cpu: '<path d="M9 2v2h6V2h2v2h1a2 2 0 0 1 2 2v1h2v2h-2v6h2v2h-2v1a2 2 0 0 1-2 2h-1v2h-2v-2H9v2H7v-2H6a2 2 0 0 1-2-2v-1H2v-2h2V9H2V7h2V6a2 2 0 0 1 2-2h1V2h2zm0 6v8h6V8H9z"/>',
  server: '<path d="M4 5a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v3a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V5zm12 1a1 1 0 1 0 0 2 1 1 0 0 0 0-2zM4 14a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v3a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-3zm12 1a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/>',
  database: '<path d="M12 2C7 2 3 3.3 3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5c0-1.7-4-3-9-3zm0 13c-4.4 0-7-1.2-7-2.5V10c1.6 1 4.1 1.5 7 1.5s5.4-.5 7-1.5v2.5c0 1.3-2.6 2.5-7 2.5z"/>',
  cloud: '<path d="M18 10h-1.3A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>',
  rocket: '<path d="M12 1.2c-2.8 1.9-5.5 6.2-6 12.3l-3.3 3.3c-.4.4-.4 1 0 1.4l1.4 1.4c.4.4 1 .4 1.4 0L9 16.5c2.7.5 7.4-.7 10.8-4.2 2.4-2.4 3-5.5 2.7-9.6-3.3-.3-7.2.3-9.6 2.7L12 1.2zM14.5 9.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM6.7 18.3l-3 3c-.4.4-1 .4-1.4 0l-.3-.3 3-3 1.7.3z"/>',
  zap: '<path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z"/>',
  shield: '<path d="M12 2l8 3v7c0 5.5-3.8 9.4-8 10-4.2-.6-8-4.5-8-10V5l8-3zm-1.3 13.7l5-5-1.4-1.4-3.6 3.6-1.6-1.6L7.7 13l3 3z"/>',
  'shield-check': '<path d="M12 2l8 3v7c0 5.5-3.8 9.4-8 10-4.2-.6-8-4.5-8-10V5l8-3zm-1.3 13.7l5-5-1.4-1.4-3.6 3.6-1.6-1.6L7.7 13l3 3z"/>',
  lock: '<path d="M17 9h-1V7a4 4 0 0 0-8 0v2H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zm-7 0V7a2 2 0 0 1 4 0v2h-4z"/>',
  key: '<path d="M15.5 3a3.5 3.5 0 0 0-3.46 4l-7.3 7.3a1 1 0 0 0-.24.53L4 18l-.3 2.7a1 1 0 0 0 1.1 1.1L7.5 21l.7-.7 1.1 1.1 1.4-1.4-1.1-1.1 1.4-1.4 1.1 1.1 1.4-1.4-1.1-1.1 2.4-2.4a3.5 3.5 0 1 0 2.7-6.6zm2 4a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"/>',
  lightbulb: '<path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z"/>',
  sparkles: '<path d="M12 2l2.1 6.4L21 10.5l-6 3L12 20l-3-6.5-6-3 6.9-2.1L12 2zm7.5 2a.5.5 0 0 0-.5.5V6h-1.5a.5.5 0 0 0 0 1H19v1.5a.5.5 0 0 0 1 0V7h1.5a.5.5 0 0 0 0-1H20V4.5a.5.5 0 0 0-.5-.5zM4.5 16a.5.5 0 0 0-.5.5V18H2.5a.5.5 0 0 0 0 1H4v1.5a.5.5 0 0 0 1 0V19h1.5a.5.5 0 0 0 0-1H5v-1.5a.5.5 0 0 0-.5-.5z"/>',
  users: '<path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm6 0a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM9 13c-3.3 0-7 1.7-7 5v2h14v-2c0-3.3-3.7-5-7-5zm6.5 0c-.4 0-.8 0-1.2.1 1.6 1.1 2.7 2.8 2.7 4.9v2h6v-2c0-3-2.9-5-7.5-5z"/>',
  'trending-up': '<path d="M23 5v6a1 1 0 0 1-1.7.7L19 9.4l-7.3 7.3a1 1 0 0 1-1.4 0L6 12.4l-5.3 5.3a1 1 0 0 1-1.4-1.4l6-6a1 1 0 0 1 1.4 0l4.3 4.3 6.6-6.6-2.3-2.3A1 1 0 0 1 16 4h6a1 1 0 0 1 1 1z"/>',
  'bar-chart-3': '<path d="M3 3a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H3zm13 4a1.5 1.5 0 0 1 1.4.9l1.4 2.9a1.5 1.5 0 0 1-1.3 2.2h-1.9l-1 2.8a1.5 1.5 0 0 1-2.8 0L9.9 12H7.5a1.5 1.5 0 0 1 0-3h3.3l.7-2.1A1.5 1.5 0 0 1 13 6h3z"/>',
  search: '<path d="M11 2a9 9 0 1 0 5.3 16.3l4.2 4.2a1 1 0 0 0 1.4-1.4l-4.2-4.2A9 9 0 0 0 11 2zm0 3a6 6 0 1 1 0 12 6 6 0 0 1 0-12z"/>',
  settings: '<path d="M19.4 13a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V19a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H19a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/>',
  package: '<path d="M12 1 3 6v12l9 5 9-5V6l-9-5zm0 2.2L19 7l-7 4-7-4 7-3.8zM5 8.6l6 3.4v8.8l-6-3.3V8.6zm8 12.2V12l6-3.4v8.9l-6 3.3z"/>',
  layers: '<path d="M12 2 2 7l10 5 10-5-10-5zm-9 15 9 4.5L21 17l-8.5 4L3 17zm0-5 9 4.5L21 12l-8.5 4L3 12z"/>',
  globe: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.9 6h-3.1c-.3-1.8-.8-3.5-1.6-5 1.9.7 3.6 2.4 4.7 5zM12 4c1 1.4 1.8 3.4 2.1 6H9.9C10.2 7.4 11 5.4 12 4zM4.3 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2h3.4c-.1.7-.1 1.3-.1 2s0 1.3.1 2H4.3zm.8 2h3.1c.3 1.8.8 3.5 1.6 5-1.9-.7-3.6-2.4-4.7-5zM9.9 20c-1-1.4-1.8-3.4-2.1-6h4.2c-.3 2.6-1.1 4.6-2.1 6zm2.1-8H7.7c.1-.7.1-1.3.1-2s0-1.3-.1-2h4.2c.1.7.1 1.3.1 2s0 1.3-.1 2zm0 4h4.2c-.3 2.6-1.1 4.6-2.1 6-1-1.4-1.8-3.4-2.1-6zm2.2-2c.1-.7.1-1.3.1-2s0-1.3-.1-2h3.4c.2.6.3 1.3.3 2s-.1 1.4-.3 2h-3.4z"/>',
  clock: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 11a1 1 0 0 1-1 1H8a1 1 0 0 1 0-2h4V6a1 1 0 0 1 2 0v6z"/>',
  calendar: '<path d="M7 2a1 1 0 0 1 1 1v1h8V3a1 1 0 0 1 2 0v1h1a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1V3a1 1 0 0 1 1-1zm12 8H5v10h14V10z"/>',
  'check-circle': '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm5.7 7.7-6 6a1 1 0 0 1-1.4 0l-3-3a1 1 0 0 1 1.4-1.4L11 13.6l5.3-5.3a1 1 0 0 1 1.4 1.4z"/>',
  'check-circle-2': '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm5.7 7.7-6 6a1 1 0 0 1-1.4 0l-3-3a1 1 0 0 1 1.4-1.4L11 13.6l5.3-5.3a1 1 0 0 1 1.4 1.4z"/>',
  check: '<path d="M20.3 5.3a1 1 0 0 0-1.4 0L9 15.2 5.1 11.3a1 1 0 0 0-1.4 1.4l4.6 4.6a1 1 0 0 0 1.4 0L20.3 8.1a1 1 0 0 0 0-1.4z"/>',
  'alert-triangle': '<path d="M12 2L1 21h22L12 2zm0 7a1 1 0 0 1 1 1v4a1 1 0 0 1-2 0v-4a1 1 0 0 1 1-1zm0 8a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"/>',
  bell: '<path d="M12 2a6 6 0 0 0-6 6c0 5-2 7-3 8-.5.5-.1 1 .6 1h16.8c.7 0 1.1-.5.6-1-1-1-3-3-3-8a6 6 0 0 0-6-6zm-2 19a2 2 0 0 0 4 0h-4z"/>',
  heart: '<path d="M12 21.4 3.6 13a5.5 5.5 0 0 1 7.8-7.8l.6.6.6-.6A5.5 5.5 0 0 1 20.4 13L12 21.4z"/>',
  flag: '<path d="M4 2v20a1 1 0 0 0 2 0v-6c1-.3 2.5-1 5-1 3 0 5 2 9 2V3c-1 0-2.5-1-5-1-3 0-5 2-9 2V2a1 1 0 0 0-2 0z"/>',
  'book-open': '<path d="M11 4a1 1 0 0 0-1-1H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5a1 1 0 0 0 1-1V4zm2 0v16a1 1 0 0 0 1 1h5a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-5a1 1 0 0 0-1 1z"/>',
  eye: '<path d="M12 4C6 4 1.5 10.5 1.2 11a1 1 0 0 0 0 2C1.5 13.5 6 20 12 20s10.5-6.5 10.8-7a1 1 0 0 0 0-2C22.5 10.5 18 4 12 4zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8z"/>',
  'arrow-right': '<path d="M4 11a1 1 0 0 0 0 2h10.6l-3.3 3.3a1 1 0 0 0 1.4 1.4l5-5a1 1 0 0 0 0-1.4l-5-5a1 1 0 1 0-1.4 1.4L14.6 11H4z"/>',
  star: '<path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.9L12 17.8 5.8 21.1 7 14.2l-5-4.9 6.9-1L12 2z"/>',
  gem: '<path d="M6 3h12l4 6-10 13L2 9l4-6zm2 2L5.5 9h4L10 5H8zm6 0l.5 4h4L16 5h-2zm-1 0l-.5 4h-5L11 5h2zM4.4 11l4 5.2L6.5 21l-3.1-10H4.4zm15.2 0h-1l-3.1 10-1.9-4.8 4-5.2h2z"/>',
  trophy: '<path d="M6 2h12v7a6 6 0 0 1-12 0V2zm-2 0h2v5H4a2 2 0 0 1 0-4zm14 0h2a2 2 0 0 1 0 4h-2V2zm-7 12a8 8 0 0 0 5-1.7V18h3v2H5v-2h3v-3.7A8 8 0 0 0 11 14z"/>',
  award: '<path d="M12 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12zm-5 14l-1 6 6-3 6 3-1-6a8 8 0 0 1-10 0z"/>',
  wrench: '<path d="M22.7 2.3a1 1 0 0 0-1.1-.2c-2.3.9-4.9.4-6.6-1.3-.8-.8-2-.8-2.8 0L3.3 9.7a1 1 0 0 0 0 1.4l4 4-2.3 2.3-2-2a1 1 0 0 0-1.4 1.4l2 2 .3.3 2 2a1 1 0 0 0 1.4-1.4l-2-2 2.3-2.3 4 4a1 1 0 0 0 1.4 0l8.9-8.9c.8-.8.8-2 0-2.8-1.7-1.7-2.3-4.3-1.3-6.6a1 1 0 0 0-.2-1.1z"/>',
  flame: '<path d="M12 2c.5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-12.1-4.9c.3.6.9 1 1.6 1 .8 0 1.5-.7 1.5-1.5 0-1.4-.5-2-1-3 0 0 1.5-2.5 3-3.6z"/>',
  palette: '<path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c1 0 1.8-.8 1.8-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.1 0-.9.7-1.6 1.6-1.6h2c3 0 5.6-2.5 5.6-5.5C22 6 17.5 2 12 2zM8 10a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5-2a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm4 3a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/>',
  smartphone: '<path d="M17 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm-5 18a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"/>',
  'message-square': '<path d="M21 3H5a2 2 0 0 0-2 2v16l4-4h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z"/>',
  'git-branch': '<path d="M18 3a3 3 0 0 0-1 5.8V10a8 8 0 0 1-8 8h-.2a3 3 0 1 0 0 2H9a10 10 0 0 0 10-10V8.8A3 3 0 0 0 18 3zM6 18a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"/>',
};

const FILLED_KEYS = Object.keys(FILLED_ICONS);

function toLucideName(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_]+/g, '-');
}

function getLineInner(name: string): string | null {
  const normalized = toLucideName(name);
  const raw = getLucideSvgRaw(normalized);
  if (raw) return extractLucideInner(raw);
  return null;
}

function getFilledInner(name: string): string | null {
  const normalized = toLucideName(name);
  if (FILLED_ICONS[normalized]) return FILLED_ICONS[normalized];
  const legacy = (LEGACY_KEY_MAP as Record<string, string>)[normalized];
  if (legacy && FILLED_ICONS[legacy]) return FILLED_ICONS[legacy];
  return null;
}

export function resolveIconName(opts: {
  name?: string;
  textHint?: string;
  index?: number;
} = {}): string {
  return resolveIconFromRegistry(opts);
}

export function isSemanticIconKey(key: string): key is SemanticIconKey {
  return key in LEGACY_KEY_MAP;
}

export function renderSvgIcon(
  keyOrName: SemanticIconKey | string,
  variant: 'line' | 'filled' = 'line',
  size: number = 20,
  color: string = 'currentColor',
  strokeWidth: number = 2,
): string {
  let name: string = keyOrName as string;
  if (isSemanticIconKey(keyOrName)) {
    name = LEGACY_KEY_MAP[keyOrName];
  }

  if (variant === 'filled') {
    let inner = getFilledInner(name);
    if (!inner) {
      inner = getLineInner(name);
      if (!inner) return '';
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg" style="display:block;flex-shrink:0;">${inner}</svg>`;
    }
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${color}" xmlns="http://www.w3.org/2000/svg" style="display:block;flex-shrink:0;">${inner}</svg>`;
  }

  const inner = getLineInner(name);
  if (!inner) {
    const filledInner = getFilledInner(name);
    if (filledInner) {
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${color}" xmlns="http://www.w3.org/2000/svg" style="display:block;flex-shrink:0;">${filledInner}</svg>`;
    }
    return '';
  }
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg" style="display:block;flex-shrink:0;">${inner}</svg>`;
}

export function renderBadgeIcon(
  keyOrName: SemanticIconKey | string,
  variant: 'line' | 'filled' = 'line',
  size: number = 48,
  iconSize: number = 22,
  primary: string = '#2563eb',
  shape: 'circle' | 'rounded' = 'circle',
): string {
  const radius = shape === 'circle' ? '50%' : '12px';
  const svg = renderSvgIcon(keyOrName, variant, iconSize, primary, variant === 'line' ? 2 : 0);
  return `<span style="display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:${size}px;height:${size}px;border-radius:${radius};background:${primary}14;">${svg}</span>`;
}

export function renderSemanticIconByIndex(
  idx: number,
  variant: 'line' | 'filled' = 'line',
  size: number = 20,
  color: string = 'currentColor',
  textHint?: string,
): string {
  const name = resolveIconFromRegistry({ textHint, index: idx });
  return renderSvgIcon(name, variant, size, color);
}

export function guessIconKey(text: string): SemanticIconKey | null {
  if (!text) return null;
  const name = resolveIconByText(text);
  if (!name) return null;
  const reverse = Object.entries(LEGACY_KEY_MAP).find(([, v]) => v === name);
  return reverse ? (reverse[0] as SemanticIconKey) : null;
}

export function getSemanticIconByIndex(idx: number): SemanticIconKey {
  const name = resolveIconByIndex(idx);
  const reverse = Object.entries(LEGACY_KEY_MAP).find(([, v]) => v === name);
  if (reverse) return reverse[0] as SemanticIconKey;
  const fallback = FILLED_KEYS[idx % FILLED_KEYS.length];
  const match = Object.entries(LEGACY_KEY_MAP).find(([, v]) => v === fallback);
  return match ? (match[0] as SemanticIconKey) : 'check';
}
