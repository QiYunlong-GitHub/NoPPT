/**
 * shared.ts 二次拆分产出：页数与页面结构解析
 * 由 html-presentation/shared.ts 的顶层声明逐块搬移，对外导出保持不变。
 */

import type { PageStructureHints, SlideCountSpec } from './types';

export const chineseNumbers: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};


export const parseNumber = (str: string): number => {
  if (/^\d+$/.test(str)) return parseInt(str);
  return chineseNumbers[str] || 0;
};


export const extractSlideCount = (text: string): number | null => {
  const spec = extractSlideCountSpec(text);
  if (!spec) return null;
  if (spec.exact != null) return spec.exact;
  if (spec.min != null && spec.max != null) return Math.floor((spec.min + spec.max) / 2);
  return null;
};


export const extractPageStructureHints = (text: string): PageStructureHints => {
  const t = (text || '').toString();
  // 分布式列举句式：单个"不要"统摄一个短句（以句号/感叹号/问号/分号/换行截断），
  // 句中同时出现 封面 / 目录 / (总结|结束) 三个词，例如"不要封面、目录和总结页"。
  // 在 25 字窗口内三者同时出现才判定，保守避免误伤。
  const noNavMatch = t.match(/不要([^。！？\n；;]{0,25})/);
  const noNavList =
    !!noNavMatch &&
    /封面/.test(noNavMatch[1]) &&
    /目录/.test(noNavMatch[1]) &&
    /(总结|结束)/.test(noNavMatch[1]);
  const hints: PageStructureHints = {
    contentOnly:
      /只生成内容页|只要内容页|只做内容页|只保留内容页|仅内容页|纯内容页|不要封面不要总结不要目录|全部内容页/.test(
        t,
      ) || noNavList,
    disableCover:
      /不生成封面页|不要封面页|不要封面|跳过封面|不做封面|无封面页|去掉封面|删去封面|不用封面|去除封面/.test(
        t,
      ),
    disableToc:
      /不生成目录页|不要目录页|不要目录|跳过目录|不做目录|无目录页|去掉目录|删去目录|不用目录|去除目录/.test(
        t,
      ),
    disableConclusion:
      /不生成总结页|不要总结页|不要总结|不要结束页|跳过总结|不做总结|无总结页|去掉总结|删去总结|不用总结|去除总结|不要结语|不要结尾|不要最后一页|不要结束/.test(
        t,
      ),
  };
  // 组合语义兜底：用户把封面/目录/总结三类结构页"同时"禁用（含顿号/逗号/和/与等连接句式，
  // 如"不要封面、目录和总结页"），等价于"只生成内容页"。仅在三者同时命中时触发，避免误伤。
  if (hints.disableCover && hints.disableToc && hints.disableConclusion) {
    hints.contentOnly = true;
  }
  // contentOnly 强覆盖：所有页面都禁用（除了内容页）
  if (hints.contentOnly) {
    hints.disableCover = true;
    hints.disableToc = true;
    hints.disableConclusion = true;
  }
  return hints;
};

/**
 * 根据「页数策略」+「用户显式禁用」推导出 理想的结构开关
 * 优先级：用户显式禁用 (hints) > 页数策略 (n)
 */

export const deriveStructureFlags = (n: number, hints: PageStructureHints) => {
  // 先基于页数给默认策略
  let wantCover = true;
  let wantToc = false;
  let wantConclusion = true;
  if (n <= 2) {
    // 1~2 页：纯内容
    wantCover = false;
    wantToc = false;
    wantConclusion = false;
  } else if (n >= 3 && n <= 5) {
    // 3~5 页：封面+内容+总结，不要目录
    wantCover = true;
    wantToc = false;
    wantConclusion = true;
  } else {
    // 6+：封面+（目录可选，但默认要）+总结
    wantCover = true;
    wantToc = true;
    wantConclusion = true;
  }
  // 用户显式禁用（高优先级覆盖）
  if (hints.contentOnly) {
    wantCover = false;
    wantToc = false;
    wantConclusion = false;
  } else {
    if (hints.disableCover) wantCover = false;
    if (hints.disableToc) wantToc = false;
    if (hints.disableConclusion) wantConclusion = false;
  }
  // 结构总量上限约束：总页数不够时宁可放弃 toc，让给内容页
  let have = (wantCover ? 1 : 0) + (wantToc ? 1 : 0) + (wantConclusion ? 1 : 0);
  if (have > n) {
    // 先去掉目录
    if (wantToc && have - 1 <= n) {
      wantToc = false;
      have--;
    }
    // 如果还超，再去掉总结（只剩1页时cover也去掉）
    if (wantConclusion && have - 1 <= n) {
      wantConclusion = false;
      have--;
    }
    if (wantCover && have - 1 <= n) {
      wantCover = false;
      have--;
    }
  }
  return { wantCover, wantToc, wantConclusion };
};

/**
 * 从主题文本中智能提取页数规格。
 * - 单值（6页、不超过5页、7页左右等） → { exact: N }
 * - 区间（5-10页、三到八页、4~6页）     → { min: X, max: Y }
 * - 不匹配 → null
 */

export const extractSlideCountSpec = (text: string): SlideCountSpec | null => {
  const numberPattern = '(?:\\d+|一|二|两|三|四|五|六|七|八|九|十)';
  const patterns: Array<{ regex: RegExp; kind: 'at-most' | 'about' | 'range' | 'exact' }> = [
    { regex: new RegExp(`(${numberPattern})\\s*页\\s*以内`, 'i'), kind: 'at-most' },
    { regex: new RegExp(`(${numberPattern})\\s*页\\s*以下`, 'i'), kind: 'at-most' },
    { regex: new RegExp(`(${numberPattern})\\s*页\\s*之内`, 'i'), kind: 'at-most' },
    { regex: new RegExp(`不超过\\s*(${numberPattern})\\s*页`, 'i'), kind: 'at-most' },
    { regex: new RegExp(`最多\\s*(${numberPattern})\\s*页`, 'i'), kind: 'at-most' },
    { regex: new RegExp(`(${numberPattern})\\s*页\\s*左右`, 'i'), kind: 'about' },
    { regex: new RegExp(`(${numberPattern})\\s*页\\s*为宜`, 'i'), kind: 'about' },
    { regex: new RegExp(`(${numberPattern})\\s*页\\s*最佳`, 'i'), kind: 'about' },
    { regex: new RegExp(`(${numberPattern})\\s*页\\s*即可`, 'i'), kind: 'about' },
    { regex: new RegExp(`(${numberPattern})-(${numberPattern})\\s*页`, 'i'), kind: 'range' },
    {
      regex: new RegExp(`(${numberPattern})\\s*到\\s*(${numberPattern})\\s*页`, 'i'),
      kind: 'range',
    },
    { regex: new RegExp(`(${numberPattern})\\s*~(${numberPattern})\\s*页`, 'i'), kind: 'range' },
    { regex: new RegExp(`(${numberPattern})\\s*页`, 'i'), kind: 'exact' },
  ];
  for (const { regex, kind } of patterns) {
    const match = text.match(regex);
    if (!match) continue;
    if (kind === 'range') {
      const num1 = parseNumber(match[1]);
      const num2 = parseNumber(match[2]);
      if (num1 > 0 && num2 > 0) {
        const min = Math.min(num1, num2);
        const max = Math.max(num1, num2);
        return { min, max };
      }
    } else {
      const num = parseNumber(match[1]);
      if (num > 0) return { exact: num };
    }
  }
  return null;
};


export function pLimit(concurrency: number) {
  const queue: Array<() => Promise<any>> = [];
  let active = 0;
  const next = () => {
    if (active >= concurrency || queue.length === 0) return;
    active++;
    const fn = queue.shift()!;
    fn().finally(() => {
      active--;
      next();
    });
  };
  return <T>(fn: () => Promise<T>): Promise<T> => {
    return new Promise((resolve, reject) => {
      queue.push(() => fn().then(resolve, reject));
      next();
    });
  };
}

/**
 * S2 · 字体族中文描述（用于插入提示词描述，让 LLM 理解当前字体风格）
 */

export function getFontFamilyDescription(family: 'sans' | 'serif' | 'mono' = 'sans'): string {
  switch (family) {
    case 'serif':
      return 'serif 衬线体（标题使用 Georgia / 宋体，典雅学术气质，适合论文 / 学术演讲 / 白皮书类演示）';
    case 'mono':
      return 'mono 等宽体（JetBrains Mono + 中文等宽回退，工程师友好、极客感，适合技术分享 / 代码演示）';
    case 'sans':
    default:
      return 'sans 无衬线体（系统默认 UI 字体，现代扁平化、通用商务风格，推荐绝大多数场景）';
  }
}

