// 轻量 CSS 级联解析（供参考 HTML 属性提取器复用）。
// 解析 <style> 块为「选择器 → 声明」表，支持 class / id / 标签 / 后代组合子的子集，
// 提供 resolveComputedDecl(el, prop)（含 CSS 变量替换）与 toHex 颜色归一化工具。
// 不引入第三方依赖，纯 JSDOM + 正则实现；只在上传参考 HTML 时执行一次，不进入逐页热路径。
//
// 设计取舍：JSDOM 的 getComputedStyle 对 class 级联支持极弱，无法可靠解析 .brand{background:#x}
// 或 var(--primary)，因此这里自实现一套"够用"的级联：
//   - 仅关心本项目白名单属性（background / color / font-family / border / border-radius / padding）
//   - 特异性排序：id(100) > class/attr(10) > tag(1)，inline 视为 1e9 恒最高
//   - CSS 变量（--name）在 :root 或任意规则中收集，查询时做 var() 替换（固定点迭代）

export interface CascadeRule {
  /** 逗号分隔下的单个选择器序列（空格分隔 = 后代组合子），如 ["div", ".card"] */
  selectors: string[];
  /** 特异性，用于冲突排序（值越大优先级越高） */
  specificity: number;
  /** 该规则声明的属性（原始值，可能含 var()） */
  decls: Record<string, string>;
}

export interface CascadeIndex {
  rules: CascadeRule[];
  /** 属性名 → 声明了该属性的规则列表（加速按属性查询） */
  byProp: Record<string, CascadeRule[]>;
  /** CSS 变量：--name → 值 */
  vars: Record<string, string>;
  /** 解析到的 <style> 规则数（用于日志/可观测） */
  styleRulesCount: number;
}

/** 颜色归一化：支持 #rgb / #rrggbb / rgb()/rgba()，返回小写 6 位 hex 或 undefined。 */
export function toHex(c: string): string | undefined {
  if (!c) return undefined;
  const s = c.trim();
  const hex = normalizeHex(s);
  if (hex) return hex;
  const m = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m) {
    const [r, g, b] = [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
    if ([r, g, b].every((v) => Number.isInteger(v) && v >= 0 && v <= 255)) {
      return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
    }
  }
  return undefined;
}

function normalizeHex(c: string): string | undefined {
  let hex = c.toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(hex)) {
    hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
  }
  if (/^#[0-9a-f]{6}$/.test(hex)) return hex;
  return undefined;
}

/** 从任意 CSS 值（含 linear-gradient / background 简写）中抽取第一个颜色 token。 */
export function firstColorIn(value: string): string | undefined {
  if (!value) return undefined;
  const g = value.match(/#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g);
  if (g) return g[0];
  const r = value.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (r) return `rgb(${r[1]}, ${r[2]}, ${r[3]})`;
  return undefined;
}

/** 解析 a=b / a / a="b" / a='b' 形式的一个属性选择器。 */
function matchAttr(attr: string, el: Element): boolean {
  const m = attr.match(/^\[([\w-]+)(?:([~|^$*]?=)["']?([^"'\]]*)["']?)?\]$/);
  if (!m) return false;
  const name = m[1].toLowerCase();
  const op = m[2];
  const val = (m[3] || '').toLowerCase();
  if (!el.hasAttribute(name)) return false;
  if (!op) return true;
  const attrVal = (el.getAttribute(name) || '').toLowerCase();
  switch (op) {
    case '=':
      return attrVal === val;
    case '~=':
      return attrVal.split(/\s+/).includes(val);
    case '|=':
      return attrVal === val || attrVal.startsWith(val + '-');
    case '^=':
      return attrVal.startsWith(val);
    case '$=':
      return attrVal.endsWith(val);
    case '*=':
      return attrVal.includes(val);
    default:
      return false;
  }
}

/** 匹配一个"简单选择器"（标签/ id / .class / [attr] 的任意组合）。 */
function matchSimple(part: string, el: Element): boolean {
  let s = part;
  let tag: string | null = null;
  let id: string | null = null;
  const classes: string[] = [];
  const attrs: string[] = [];
  const re = /(\*|[a-zA-Z][\w-]*)|(#[\w-]+)|((?:\.[\w-]+)+)|(\[[^\]]+\])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m[1]) tag = m[1];
    else if (m[2]) id = m[2].slice(1);
    else if (m[3]) for (const c of m[3].split('.').filter(Boolean)) classes.push(c);
    else if (m[4]) attrs.push(m[4]);
  }
  if (tag && tag !== '*' && el.tagName.toLowerCase() !== tag) return false;
  if (id && el.id !== id) return false;
  for (const c of classes) if (!el.classList.contains(c)) return false;
  for (const a of attrs) if (!matchAttr(a, el)) return false;
  return true;
}

/** 后代组合子匹配：最后一个简单选择器命中 el，其前的依次在某层祖先上命中。 */
function selectorMatches(selector: string, el: Element): boolean {
  const seq = selector.trim().split(/\s+/).filter(Boolean);
  if (!seq.length) return false;
  if (!matchSimple(seq[seq.length - 1], el)) return false;
  let idx = seq.length - 2;
  let cur = el.parentElement;
  while (idx >= 0) {
    while (cur && !matchSimple(seq[idx], cur)) cur = cur.parentElement;
    if (!cur) return false;
    cur = cur.parentElement;
    idx--;
  }
  return true;
}

function specificityOf(selectors: string[]): number {
  let max = 0;
  for (const sel of selectors) {
    let spec = 0;
    const re = /(\*|[a-zA-Z][\w-]*)|(#[\w-]+)|((?:\.[\w-]+)+)|(\[[^\]]+\])/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sel))) {
      if (m[1]) spec += m[1] === '*' ? 0 : 1;
      else if (m[2]) spec += 100;
      else if (m[3]) spec += 10 * m[3].split('.').filter(Boolean).length;
      else if (m[4]) spec += 10;
    }
    if (spec > max) max = spec;
  }
  return max;
}

function parseRule(
  pre: string,
  body: string,
  outRules: CascadeRule[],
  vars: Record<string, string>,
): void {
  const selectors = pre
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!selectors.length) return;
  const decls: Record<string, string> = {};
  for (const raw of body.split(';')) {
    const decl = raw.trim();
    if (!decl) continue;
    const ci = decl.indexOf(':');
    if (ci === -1) continue;
    const prop = decl.slice(0, ci).trim().toLowerCase();
    const value = decl.slice(ci + 1).trim();
    if (!prop || !value) continue;
    if (prop.startsWith('--')) {
      vars[prop] = value;
      continue;
    }
    decls[prop] = value;
  }
  if (Object.keys(decls).length === 0) return;
  outRules.push({ selectors, specificity: specificityOf(selectors), decls });
}

function parseCss(css: string, outRules: CascadeRule[], vars: Record<string, string>): number {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let i = 0;
  let count = 0;
  while (i < css.length) {
    const brace = css.indexOf('{', i);
    if (brace === -1) break;
    const pre = css.slice(i, brace).trim();
    let depth = 0;
    let j = brace;
    for (; j < css.length; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    const body = css.slice(brace + 1, j);
    i = j + 1;
    if (pre.startsWith('@') || !pre) continue; // 跳过 @media / @keyframes 等 at-rule 整块
    parseRule(pre, body, outRules, vars);
    count++;
  }
  return count;
}

/** 构建级联索引。忽略 <link> 外链（无法本地解析）。 */
export function buildCascadeIndex(doc: Document): CascadeIndex {
  const rules: CascadeRule[] = [];
  const vars: Record<string, string> = {};
  let styleRulesCount = 0;
  doc.querySelectorAll('style').forEach((styleEl) => {
    styleRulesCount += parseCss(styleEl.textContent || '', rules, vars);
  });
  const byProp: Record<string, CascadeRule[]> = {};
  for (const r of rules) {
    for (const p of Object.keys(r.decls)) {
      (byProp[p] ||= []).push(r);
    }
  }
  return { rules, byProp, vars, styleRulesCount };
}

/** 统计 HTML 中 <style> 块的规则数（供日志/可观测，不依赖 JSDOM）。 */
export function countStyleRules(html: string): number {
  if (!html) return 0;
  let total = 0;
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m: RegExpExecArray | null;
  while ((m = styleRe.exec(html))) {
    total += parseCss(m[1] || '', [], {});
  }
  return total;
}

/** var() 替换（固定点迭代，最多 5 次）。 */
function resolveVars(value: string, vars: Record<string, string>): string {
  let v = value;
  for (let i = 0; i < 5; i++) {
    let changed = false;
    v = v.replace(
      /var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g,
      (_m, name: string, fallback?: string) => {
        if (vars[name] != null) {
          changed = true;
          return vars[name];
        }
        changed = true;
        return fallback != null ? fallback : '';
      },
    );
    if (!changed) break;
  }
  return v;
}

/**
 * 计算某元素在某属性上的"级联最终值"。
 * @param inline 该元素内联 style 中该属性的值（已抽取），无则传 ''。
 * @returns 经过 var() 替换后的原始值字符串，未命中返回 undefined。
 */
export function resolveComputedDecl(
  el: Element,
  prop: string,
  inline: string,
  index: CascadeIndex,
): string | undefined {
  const arr = index.byProp[prop] || [];
  let bestSpec = -1;
  let bestVal: string | undefined;
  for (const r of arr) {
    if (r.specificity < bestSpec) continue;
    if (r.selectors.some((sel) => selectorMatches(sel, el))) {
      bestSpec = r.specificity;
      bestVal = r.decls[prop];
    }
  }
  const inVal = inline && inline.trim() ? inline.trim() : undefined;
  if (inVal && 1e9 > bestSpec) {
    bestSpec = 1e9;
    bestVal = inVal;
  }
  if (!bestVal) return undefined;
  return resolveVars(bestVal, index.vars);
}
