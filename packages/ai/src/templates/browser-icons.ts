/// <reference path="../lucide-static-icons.d.ts" />

import target from 'lucide-static/dist/esm/icons/target.mjs';
import zap from 'lucide-static/dist/esm/icons/zap.mjs';
import shield from 'lucide-static/dist/esm/icons/shield.mjs';
import lightbulb from 'lucide-static/dist/esm/icons/lightbulb.mjs';
import rocket from 'lucide-static/dist/esm/icons/rocket.mjs';
import code from 'lucide-static/dist/esm/icons/code.mjs';
import users from 'lucide-static/dist/esm/icons/users.mjs';
import barChart3 from 'lucide-static/dist/esm/icons/chart-bar.mjs';
import settings from 'lucide-static/dist/esm/icons/settings.mjs';
import globe from 'lucide-static/dist/esm/icons/globe.mjs';
import database from 'lucide-static/dist/esm/icons/database.mjs';
import cloud from 'lucide-static/dist/esm/icons/cloud.mjs';
import cpu from 'lucide-static/dist/esm/icons/cpu.mjs';
import layers from 'lucide-static/dist/esm/icons/layers.mjs';
import gitBranch from 'lucide-static/dist/esm/icons/git-branch.mjs';
import workflow from 'lucide-static/dist/esm/icons/workflow.mjs';
import checkCircle2 from 'lucide-static/dist/esm/icons/circle-check.mjs';
import star from 'lucide-static/dist/esm/icons/star.mjs';
import packageIcon from 'lucide-static/dist/esm/icons/package.mjs';
import terminal from 'lucide-static/dist/esm/icons/terminal.mjs';
import key from 'lucide-static/dist/esm/icons/key.mjs';
import lock from 'lucide-static/dist/esm/icons/lock.mjs';
import search from 'lucide-static/dist/esm/icons/search.mjs';
import bell from 'lucide-static/dist/esm/icons/bell.mjs';
import bookOpen from 'lucide-static/dist/esm/icons/book-open.mjs';
import calendar from 'lucide-static/dist/esm/icons/calendar.mjs';
import mail from 'lucide-static/dist/esm/icons/mail.mjs';
import messageSquare from 'lucide-static/dist/esm/icons/message-square.mjs';
import phone from 'lucide-static/dist/esm/icons/phone.mjs';
import eye from 'lucide-static/dist/esm/icons/eye.mjs';
import clock from 'lucide-static/dist/esm/icons/clock.mjs';
import trendingUp from 'lucide-static/dist/esm/icons/trending-up.mjs';
import award from 'lucide-static/dist/esm/icons/award.mjs';
import heart from 'lucide-static/dist/esm/icons/heart.mjs';
import flag from 'lucide-static/dist/esm/icons/flag.mjs';

const FALLBACK_ORDER = [
  'target',
  'zap',
  'shield',
  'lightbulb',
  'rocket',
  'code',
  'users',
  'bar-chart-3',
  'settings',
  'globe',
  'database',
  'cloud',
  'cpu',
  'layers',
  'git-branch',
  'workflow',
  'check-circle-2',
  'star',
  'package',
  'terminal',
  'key',
  'lock',
  'search',
  'bell',
  'book-open',
  'calendar',
  'mail',
  'message-square',
  'phone',
  'eye',
  'clock',
  'trending-up',
  'award',
  'heart',
  'flag',
] as const;

type BrowserIconName = (typeof FALLBACK_ORDER)[number];

const ICONS: Record<BrowserIconName, string> = {
  target,
  zap,
  shield,
  lightbulb,
  rocket,
  code,
  users,
  'bar-chart-3': barChart3,
  settings,
  globe,
  database,
  cloud,
  cpu,
  layers,
  'git-branch': gitBranch,
  workflow,
  'check-circle-2': checkCircle2,
  star,
  package: packageIcon,
  terminal,
  key,
  lock,
  search,
  bell,
  'book-open': bookOpen,
  calendar,
  mail,
  'message-square': messageSquare,
  phone,
  eye,
  clock,
  'trending-up': trendingUp,
  award,
  heart,
  flag,
};

function innerSvg(raw: string): string {
  return raw.match(/<svg[^>]*>([\s\S]*?)<\/svg>/i)?.[1]?.trim() ?? '';
}

export function resolveIconByIndex(index: number): BrowserIconName {
  return FALLBACK_ORDER[
    ((index % FALLBACK_ORDER.length) + FALLBACK_ORDER.length) % FALLBACK_ORDER.length
  ];
}

export function renderSvgIcon(
  name: string,
  variant: 'line' | 'filled' = 'line',
  size = 20,
  color = 'currentColor',
  strokeWidth = 2,
): string {
  const raw = ICONS[name as BrowserIconName];
  if (!raw) return '';
  const inner = innerSvg(raw);
  if (variant === 'filled') {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${color}" xmlns="http://www.w3.org/2000/svg" style="display:block;flex-shrink:0;">${inner}</svg>`;
  }
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg" style="display:block;flex-shrink:0;">${inner}</svg>`;
}
