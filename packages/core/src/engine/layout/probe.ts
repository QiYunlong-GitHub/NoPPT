import {
  parseStyleDeclarations,
} from '../visual-fixes';

import {
  setDecl,
  delDecl,
  getDecl,
  transformStyleAttr,
  findMatchingClose,
} from './dom';
/** 解析 style 中 flex: 0 0 XX% 的百分比（未找到返回 null） */
export function parseFlexBasisPercent(styleVal: string): number | null {
  const decls = parseStyleDeclarations(styleVal);
  const flex = getDecl(decls, 'flex');
  if (flex) {
    const m = flex.match(/0\s+0\s+(\d+(?:\.\d+)?)%/);
    if (m) return parseFloat(m[1]);
  }
  const basis = getDecl(decls, 'flex-basis');
  if (basis) {
    const m = basis.match(/(\d+(?:\.\d+)?)%/);
    if (m) return parseFloat(m[1]);
  }
  return null;
}


/** 判断 UL style 是否是单列 flex（非 grid） */
export function isSingleColumnFlexUl(styleVal: string): boolean {
  const decls = parseStyleDeclarations(styleVal);
  const display = (getDecl(decls, 'display') || '').toLowerCase();
  if (display === 'grid') return false;
  const flexDir = (getDecl(decls, 'flex-direction') || '').toLowerCase();
  return flexDir === 'column' || display === 'flex'; // 没写 flex-direction 默认 column（我们的布局都是 column）
}


/** 解析 grid-template-columns: repeat(N,1fr) 中的列数 N（未匹配返回 null） */
export function parseGridRepeatCols(styleVal: string): number | null {
  const decls = parseStyleDeclarations(styleVal);
  const display = (getDecl(decls, 'display') || '').toLowerCase();
  if (display !== 'grid') return null;
  const gtc = getDecl(decls, 'grid-template-columns');
  if (!gtc) return null;
  const m = gtc.match(/repeat\(\s*(\d+)\s*,\s*1fr\s*\)/);
  if (m) return parseInt(m[1], 10);
  return null;
}


/** FR-5：探测「H2 -> 卡片 grid (N>=3 列) -> 底部 img」的 stats-grid-bottom-image 布局。
 *  成功返回 probe；否则返回 null（调用方再回退到 UL/OL 探测）。 */
export function probeStatsGridBottomImage(html: string): VerticalLayoutProbe | null {
  const h2Re = /<h2\b([^>]*)>[\s\S]*?<\/h2>/i;
  const h2Match = html.match(h2Re);
  if (!h2Match || h2Match.index === undefined) return null;
  const h2EndAbs = h2Match.index + h2Match[0].length;
  const afterH2 = html.slice(h2EndAbs);

  // 水平双栏（img 和 grid 分别在两个 flex 兄弟列）直接跳过
  const imgRe = /<img\b([^>]*)>/i;
  const gridRe = /<div\b([^>]*style="[^"]*display\s*:\s*grid[^"]*"[^>]*)>/i;
  const imgMatch = afterH2.match(imgRe);
  const gridMatch = afterH2.match(gridRe);
  if (!imgMatch || !gridMatch) return null;
  const imgRelIdx = imgMatch.index!;
  const gridRelIdx = gridMatch.index!;

  // 仅处理 grid 在 img 之前（卡片在上、图片在下即 BOTTOM 模式）
  if (gridRelIdx > imgRelIdx) return null;
  // 若结构里还存在 UL/OL 且位置比 grid 更早，则这是「列表 + 图」老结构，走老路径
  const listRe = /<(ul|ol)\b([^>]*)>/i;
  const listMatch = afterH2.match(listRe);
  if (listMatch && listMatch.index !== undefined && listMatch.index < gridRelIdx) return null;

  // 水平双栏判定：grid 与 img 若在两个 flex:0 0 XX% 兄弟列中 → 跳过
  if (isHorizontalImageSide(afterH2, imgRelIdx, gridRelIdx)) return null;

  // grid 列数 N>=3
  const gridStyleMatch = gridMatch[1].match(/style="([^"]*)"/i);
  if (!gridStyleMatch) return null;
  const cols = parseGridRepeatCols(gridStyleMatch[1]);
  if (cols === null || cols < 3) return null;

  // 找到 imgWrap: img 之前最近一个有 flex:0 0 XX% 或 flex-basis XX% 的 div
  const beforeImg = afterH2.slice(0, imgRelIdx);
  const divOpenRe = /<div\b([^>]*)>/gi;
  let lastDivMatch: RegExpMatchArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = divOpenRe.exec(beforeImg)) !== null) lastDivMatch = m;
  if (!lastDivMatch) return null;
  const imgWrapStyleMatch = lastDivMatch[1].match(/style="([^"]*)"/i);
  if (!imgWrapStyleMatch) return null;
  const flexPct = parseFlexBasisPercent(imgWrapStyleMatch[1]);
  // FR-5 兜底：即便 imgWrap 不是 flex:0 0 XX%（例如 slide-04 场景下还没加 flex basis），
  // 我们依然允许后续 Step 2 把它改造成压缩样式，这里只要求 style 声明存在；
  // 为避免误伤，我们在 flexPct === null 时额外判断：imgWrap 是否含 display:flex（即真实的 flex 容器）
  if (flexPct === null) {
    const decls = parseStyleDeclarations(imgWrapStyleMatch[1]);
    const disp = (getDecl(decls, 'display') || '').toLowerCase();
    if (disp !== 'flex') return null;
  }

  const gridOpenAbs = h2EndAbs + gridRelIdx;
  // 用列数做"虚拟 liCount"，保证 Step 2 阶梯被触发（>=3）
  return {
    mode: 'bottom',
    liCount: cols,
    ulTagName: 'ul',
    ulOpenGlobalIdx: gridOpenAbs,
    layoutKind: 'stats-grid',
    cardCols: cols,
  };
}


/** 把 UL style 从单列 flex → 双列 Grid；并返回 style 字符串（已 transform） */
export function convertUlTo2ColGrid(ulOpenTag: string): string {
  return transformStyleAttr(ulOpenTag, (decls) => {
    // 替换 display / flex-direction 为 grid
    delDecl(decls, 'display');
    delDecl(decls, 'flex-direction');
    setDecl(decls, 'display', 'grid');
    setDecl(decls, 'grid-template-columns', 'repeat(2,1fr)');
    // gap：同时兼容 row/column，把单行 gap 拆分为紧凑 12px 20px
    const gap = getDecl(decls, 'gap');
    if (gap) {
      // 原 gap 可能只有一个值（如 16px），改成 row 12px / col 20px
      setDecl(decls, 'gap', '12px 20px');
    } else {
      setDecl(decls, 'gap', '12px 20px');
    }
    // 保持 list-style/ margin / padding 不变（若缺失则补齐）
    if (!getDecl(decls, 'margin')) setDecl(decls, 'margin', '0');
    if (!getDecl(decls, 'padding')) setDecl(decls, 'padding', '0');
    if (!getDecl(decls, 'list-style')) setDecl(decls, 'list-style', 'none');
    if (!getDecl(decls, 'min-width')) setDecl(decls, 'min-width', '0');
    return true;
  });
}


/** 使单个 li 样式更紧凑（双列模式）：padding/字号/icon 缩小一挡 */
export function tightenLiStyle(liOpenTag: string): string {
  return transformStyleAttr(liOpenTag, (decls) => {
    let changed = false;
    // padding：16px 24px → 12px 20px
    const pad = getDecl(decls, 'padding');
    if (pad) {
      setDecl(decls, 'padding', '12px 20px');
      changed = true;
    }
    // 缩小 gap（通常是 14px → 12px）
    const gap = getDecl(decls, 'gap');
    if (gap) {
      setDecl(decls, 'gap', '12px');
      changed = true;
    }
    return changed;
  });
}


/** 缩小 li 内的文字 span 字号：24px → 20px；28px → 22px */
export function tightenTextSpanInLi(spanOpenTag: string): string {
  return transformStyleAttr(spanOpenTag, (decls) => {
    let changed = false;
    const fs = getDecl(decls, 'font-size');
    if (fs) {
      const m = fs.match(/(\d+(?:\.\d+)?)px/);
      if (m) {
        const n = parseFloat(m[1]);
        if (n >= 27) {
          setDecl(decls, 'font-size', '22px');
          changed = true;
        } else if (n >= 23) {
          setDecl(decls, 'font-size', '20px');
          changed = true;
        }
      }
    }
    return changed;
  });
}


/** 缩小 li 内图标容器（40px → 36px；20px 字号 → 18px） */
export function tightenIconSpanInLi(spanOpenTag: string): string {
  return transformStyleAttr(spanOpenTag, (decls) => {
    let changed = false;
    const w = getDecl(decls, 'width');
    const h = getDecl(decls, 'height');
    if (w && /40px/.test(w)) {
      setDecl(decls, 'width', '36px');
      changed = true;
    }
    if (h && /40px/.test(h)) {
      setDecl(decls, 'height', '36px');
      changed = true;
    }
    const fs = getDecl(decls, 'font-size');
    if (fs) {
      const m = fs.match(/(\d+(?:\.\d+)?)px/);
      if (m) {
        const n = parseFloat(m[1]);
        if (n >= 19) {
          setDecl(decls, 'font-size', '18px');
          changed = true;
        }
      }
    }
    return changed;
  });
}


/** 压缩 H2 标题（仅当 li≥5 时触发） */
export function tightenH2(h2OpenTag: string): string {
  return transformStyleAttr(h2OpenTag, (decls) => {
    let changed = false;
    // font-size:44px → 40px
    const fs = getDecl(decls, 'font-size');
    if (fs) {
      const m = fs.match(/(\d+(?:\.\d+)?)px/);
      if (m && parseFloat(m[1]) >= 43) {
        setDecl(decls, 'font-size', '40px');
        changed = true;
      }
    }
    // margin-bottom:32px → 20px
    const mb = getDecl(decls, 'margin-bottom');
    if (mb) {
      const m = mb.match(/(\d+(?:\.\d+)?)px/);
      if (m && parseFloat(m[1]) >= 30) {
        setDecl(decls, 'margin-bottom', '20px');
        changed = true;
      }
    }
    // line-height:1.25 → 1.2
    const lh = getDecl(decls, 'line-height');
    if (lh && /1\.25/.test(lh)) {
      setDecl(decls, 'line-height', '1.2');
      changed = true;
    }
    return changed;
  });
}


/** 探测 H2 后垂直布局中「图片容器 + 列表」或「卡片 grid + 底部图片」的模式：
 *  - 'top'    →  图片(flex:0 0 XX%) 在列表之前（真正的上图下文）
 *  - 'bottom' →  列表/卡片grid 在图片之前（LLM把顺序调换了，即"下文上图"，DOM顺序bottom化）
 *  探测失败返回 null（不进入修复）
 */
export interface VerticalLayoutProbe {
  mode: 'top' | 'bottom';
  liCount: number; // ul-list: 实际 li 数; stats-grid: 用列数（用于阶梯判定）
  ulTagName: 'ul' | 'ol'; // 仅 ul-list 模式有意义；stats-grid 占位为 'ul'
  ulOpenGlobalIdx: number; // UL/OL 或卡片 grid div 开标签在整 html 中的起始下标
  layoutKind: 'ul-list' | 'stats-grid';
  cardCols?: number; // stats-grid 时的列数（N>=3）
}

/** 探测 H2 后是否存在「水平双栏」布局：
 *  - 在 afterH2 最近的一级（未遇到 UL/OL 前）里，若发现一对兄弟 div：
 *      ① flex:0 0 XX%（含 <img>）     ② flex:0 0 YY%（含 <ul/ol>）   或顺序相反，
 *    且两者都挂在同一个「flex row 容器」下 → 认定为水平排布，跳过垂直压缩。 */
export function isHorizontalImageSide(afterH2: string, imgRelIdx: number, listRelIdx: number): boolean {
  // 找两个 flex:0 0 XX% 的子容器各自的 <div 起始位置，
  // 允许 imageWrap 在 list 前或后（图左文右 / 文左图右）。
  // 先找 imgWrap：imgRelIdx 前最后一个 <div ... style="...flex:0 0 XX%...">（满足 parseFlexBasisPercent）。
  const beforeImg = afterH2.slice(0, imgRelIdx);
  const lastFlexDivBeforeImg = findLastFlexBasisDiv(beforeImg);
  if (!lastFlexDivBeforeImg) return false;

  // 再找 listWrap：listRelIdx 前最后一个 <div ... style="...flex:0 0 XX%...">
  const beforeList = afterH2.slice(0, listRelIdx);
  const lastFlexDivBeforeList = findLastFlexBasisDiv(beforeList);
  if (!lastFlexDivBeforeList) return false;

  // 两者必须是不同 div（两个分栏），且 imgWrap 应该包含图片、listWrap 应该包含 list，顺序无关。
  // —— T5-FR5 HOTFIX②：在"img 列 45%（图左文右）→ 紧接着 ul 无外层 div"的结构下，
  //   beforeList 内 lastFlexDivBeforeList.start === lastFlexDivBeforeImg.start 并非"真 listWrap"，
  //   说明列表本身就没有 flex:0 0 XX% wrapper（ai 直接把 ul 当列）；此时不能因为找不到第二个 flex div 就判失败，
  //   应直接回退：如果两个 flex 锚定同一列，且另一列实际是 <ul> 本身（紧挨该列之后），
  //   我们只需证明 img 列 + ul 在同一个 flex row 父容器里 → 算作水平双栏（listWrap 当成 0 0 55% 虚拟列）。
  if (lastFlexDivBeforeList.start === lastFlexDivBeforeImg.start) {
    // 检查在"img 列之后 + listRelIdx 之前"是否存在紧接的 ul/ol 开标签
    const between = afterH2.slice(lastFlexDivBeforeImg.start + 1, listRelIdx);
    // 需出现过 </div> 关闭 img 列，且随后没有第二个 div.flex wrapper，才是"裸 ul"结构
    const closed = /<\/div>/i.test(between);
    const noSecondFlexDiv = findFirstFlexBasisDiv(between) === null;
    if (closed && noSecondFlexDiv) {
      const [imgStart, imgPct] = [lastFlexDivBeforeImg.start, lastFlexDivBeforeImg.pct];
      // 推断 list 列为 100% - imgPct（四舍五入到 55/45/60/40/65/35 这几种常见比例都合法）
      const listPctInferred = Math.round(100 - imgPct);
      const sumPct = imgPct + listPctInferred;
      if (sumPct < 95 || sumPct > 105) return false;
      const earliest = imgStart;
      const beforeBoth = afterH2.slice(0, earliest);
      const probeWindow =
        beforeBoth.endsWith('>') === false
          ? afterH2.slice(0, Math.min(afterH2.length, earliest + 120))
          : beforeBoth;
      const rowParent = findLastFlexRowParent(probeWindow);
      if (rowParent === null) return false;
      return true;
    }
    // 否则尝试在 img 列之后扫描第二个 flex:0 0 XX% 作为真 listWrap 兜底
    const afterImgDiv = afterH2.slice(lastFlexDivBeforeImg.start + 1, listRelIdx);
    const rewind = findFirstFlexBasisDiv(afterImgDiv);
    if (rewind) {
      lastFlexDivBeforeList.start = lastFlexDivBeforeImg.start + 1 + rewind.start;
      lastFlexDivBeforeList.pct = rewind.pct;
    }
    if (lastFlexDivBeforeList.start === lastFlexDivBeforeImg.start) return false;
  }
  const [imgStart, imgPct] = [lastFlexDivBeforeImg.start, lastFlexDivBeforeImg.pct];
  const [listStart, listPct] = [lastFlexDivBeforeList.start, lastFlexDivBeforeList.pct];
  const sumPct = imgPct + listPct;
  if (sumPct < 85 || sumPct > 110) return false;

  // 找到更早的父级容器（display:flex 且 flex-direction 非 column 或缺省）：
  // 取两个 start 中较小者的之前的片段，找最后一个 display:flex 的外层。
  const earliest = Math.min(imgStart, listStart);
  const beforeBoth = afterH2.slice(0, earliest);
  // T5-FR5 HOTFIX：如果 beforeBoth 内部就只有 <div…> 开标签（beforeBoth 从 afterH2 开头开始、
  // beforeH2 只有一个 row 容器），那么 beforeBoth 的末尾应当正好落在子列开标签之前；
  // 但 beforeBoth 若未以 > 结尾说明没有包含 row 容器结束 >，
  // 导致 findLastFlexRowParent 把内部 flex 样式当成属性片段而非完整开标签 → 正则无法命中。
  // 此时将 beforeBoth 向后补最多 120 字符，使其包含第一个完整开标签再扫描父级 row。
  const probeWindow =
    beforeBoth.endsWith('>') === false
      ? afterH2.slice(0, Math.min(afterH2.length, earliest + 120))
      : beforeBoth;
  const rowParent = findLastFlexRowParent(probeWindow);
  // T5-FR5 HOTFIX：rowParent === 0 是合法值（row 容器出现在 afterH2 开头，极常见），
  // 不能用 if (!rowParent) 判定——必须显式 === null，避免 index=0 被误判为"未找到"。
  if (rowParent === null) return false;

  // 两个 flex div 的 start 都应当在 rowParent 之后（属于其 children），这已由 beforeBoth 定义保证。
  return true;
}


/** 在片段里找"第一个" flex:0 0 XX% 开标签（用于在已知列之后定位第二个分栏 div） */
export function findFirstFlexBasisDiv(text: string): { start: number; pct: number } | null {
  const re = /<div\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const attrs = m[1];
    const sm = attrs.match(/style="([^"]*)"/i);
    if (!sm) continue;
    const p = parseFlexBasisPercent(sm[1]);
    if (p !== null) return { start: m.index, pct: p };
  }
  return null;
}


export function findLastFlexBasisDiv(text: string): { start: number; pct: number } | null {
  const re = /<div\b([^>]*)>/gi;
  let best: { start: number; pct: number } | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const attrs = m[1];
    const sm = attrs.match(/style="([^"]*)"/i);
    if (!sm) continue;
    const p = parseFlexBasisPercent(sm[1]);
    if (p !== null) best = { start: m.index, pct: p };
  }
  return best;
}


export function findLastFlexRowParent(text: string): number | null {
  // 找最后一个 display:flex / display:inline-flex 的开标签，且 flex-direction ≠ column。
  const re = /<(?:div|section|article)\b([^>]*)>/gi;
  let bestIdx: number | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const attrs = m[1];
    const sm = attrs.match(/style="([^"]*)"/i);
    if (!sm) continue;
    const decls = parseStyleDeclarations(sm[1]);
    const display = (getDecl(decls, 'display') || '').toLowerCase();
    if (display !== 'flex' && display !== 'inline-flex') continue;
    const fd = (getDecl(decls, 'flex-direction') || '').toLowerCase();
    if (fd === 'column' || fd === 'column-reverse') continue;
    bestIdx = m.index;
  }
  return bestIdx;
}


export function probeVerticalImageLayout(html: string): VerticalLayoutProbe | null {
  const h2Re = /<h2\b([^>]*)>[\s\S]*?<\/h2>/i;
  const h2Match = html.match(h2Re);
  if (!h2Match || h2Match.index === undefined) return null;
  const h2EndAbs = h2Match.index + h2Match[0].length;
  const afterH2 = html.slice(h2EndAbs);

  // 同时找 H2 之后第一个 <img> 和第一个 <ul/ol>
  const imgRe = /<img\b([^>]*)>/i;
  const listRe = /<(ul|ol)\b([^>]*)>/i;
  const imgMatch = afterH2.match(imgRe);
  const listMatch = afterH2.match(listRe);
  if (!imgMatch || !listMatch) return null;
  const imgRelIdx = imgMatch.index!;
  const listRelIdx = listMatch.index!;

  // T2-FR2: 先判定「水平双栏」：如果 img / list 分别在两个 flex:0 0 XX% 兄弟分栏中
  // （且两者百分比之和接近一整行，父容器为 flex row），则为水平布局，
  // 垂直压缩 + 双列 grid 均不应介入 → 直接返回 null 跳过修复。
  if (isHorizontalImageSide(afterH2, imgRelIdx, listRelIdx)) return null;

  // 决定谁在前：
  //   TOP    → img 在 list 之前（imgRelIdx < listRelIdx）
  //   BOTTOM → list 在 img 之前（listRelIdx < imgRelIdx）
  const mode: 'top' | 'bottom' = imgRelIdx < listRelIdx ? 'top' : 'bottom';

  // 无论哪种模式，都必须找到「包裹 <img> 且有 flex:0 0 XX% 的 div」作为图片压缩目标
  // 如果是 TOP 模式，这个 imgWrap 在 beforeImg（img 前）中查找最后一个 div；
  // 如果是 BOTTOM 模式，这个 imgWrap 也在 <img> 前（即列表与 img 之间）找最后一个 div。
  const beforeImg = afterH2.slice(0, imgRelIdx);
  const divOpenRe = /<div\b([^>]*)>/gi;
  let lastDivMatch: RegExpMatchArray | null = null;
  let m: RegExpMatchArray | null;
  while ((m = divOpenRe.exec(beforeImg)) !== null) lastDivMatch = m;
  if (!lastDivMatch) return null;
  const imgWrapStyleMatch = lastDivMatch[1].match(/style="([^"]*)"/i);
  if (!imgWrapStyleMatch) return null;
  const flexPct = parseFlexBasisPercent(imgWrapStyleMatch[1]);
  if (flexPct === null) return null;

  // 验证列表是单列 flex（未被 Grid 化）
  const listAttrs = listMatch[2];
  const listStyleMatch = listAttrs.match(/style="([^"]*)"/i);
  if (listStyleMatch && !isSingleColumnFlexUl(listStyleMatch[1])) return null;

  // 数 li
  const ulOpenAbs = h2EndAbs + listRelIdx;
  const tag = (listMatch[1] as 'ul' | 'ol').toLowerCase() as 'ul' | 'ol';
  const ulCloseAbs = findMatchingClose(html, ulOpenAbs, tag);
  if (ulCloseAbs === -1) return null;
  const ulInner = html.slice(ulOpenAbs, ulCloseAbs);
  const liCount = (ulInner.match(/<li\b/gi) || []).length;
  if (liCount === 0) return null;

  return { mode, liCount, ulTagName: tag, ulOpenGlobalIdx: ulOpenAbs, layoutKind: 'ul-list' };
}


export function preventContentImageTopOverflow(html: string): string {
  // ------------------- ① 特征匹配：TOP or BOTTOM 垂直图片列表布局 -------------------
  // FR-5：先探测「卡片 grid + 底部图片」stats-grid-bottom-image；再回退到 UL/OL 老布局
  let probe: VerticalLayoutProbe | null = probeStatsGridBottomImage(html);
  if (!probe) probe = probeVerticalImageLayout(html);
  if (!probe) return html;
  const { mode, liCount, layoutKind } = probe;

  // ------------------- ② 根据 li 数量进入不同修复阶梯 -------------------
  let output = html;
  let repaired = false;

  // Step 1：li>=4，单列 → 双列 Grid，并紧凑化 li 卡片样式（TOP/BOTTOM 都需要，因为高度瓶颈相同）
  // FR-5：stats-grid 模式下卡片本身就是 display:grid with N>=3 列，跳过 Step 1（不做转双列/li 紧凑化）
  if (layoutKind !== 'stats-grid' && liCount >= 4) {
    output = output.replace(/(<(ul|ol)\b[^>]*>)/i, (fullMatch) => {
      const newTag = convertUlTo2ColGrid(fullMatch);
      if (newTag !== fullMatch) repaired = true;
      return newTag;
    });
    output = output.replace(/<li\b([^>]*)>/gi, (m) => {
      const r = tightenLiStyle(m);
      if (r !== m) repaired = true;
      return r;
    });
    // 文字 span：样式有 font-size:24/28px 且有 flex:1
    output = output.replace(
      /<span\b([^>]*style="[^"]*font-size\s*:\s*(?:24|28)px[^"]*flex\s*:\s*1[^"]*"[^>]*)>/gi,
      (m) => {
        const r = tightenTextSpanInLi(m);
        if (r !== m) repaired = true;
        return r;
      },
    );
    // 图标 span：width:40px;height:40px
    output = output.replace(
      /<span\b([^>]*style="[^"]*width\s*:\s*40px[^"]*height\s*:\s*40px[^"]*)>/gi,
      (m) => {
        const r = tightenIconSpanInLi(m);
        if (r !== m) repaired = true;
        return r;
      },
    );
  }

  // Step 2：按 li 数量 / 卡片列数 压缩图片容器高度（TOP/BOTTOM 均需要，只是 margin 方向不同）
  // FR-5：stats-grid 模式统一 32% + margin-top:24px（不按列数阶梯变化）
  if (liCount >= 3) {
    let targetPct = 40;
    let marginSide: 'margin-top' | 'margin-bottom' =
      mode === 'top' ? 'margin-bottom' : 'margin-top';
    let newMarginVal = '20px';
    if (layoutKind === 'stats-grid') {
      targetPct = 32;
      newMarginVal = '24px';
    } else if (liCount === 3) {
      targetPct = 40;
      newMarginVal = '20px';
    } else if (liCount === 4) {
      targetPct = 35;
      newMarginVal = '16px';
    } else {
      targetPct = 32;
      newMarginVal = '16px';
    }

    // FR-5：stats-grid 模式下 imgWrap 可能还没有 flex:0 0 XX%（LLM 原生仅 display:flex），
    // 所以放宽匹配——只要是带 style 的 div 且紧接 <img> 就允许 transform 注入 flex:0 0 32%
    const imgWrapRe =
      layoutKind === 'stats-grid'
        ? /(<div\b[^>]*style="[^"]*"[^>]*>)(?=\s*<img\b)/i
        : /(<div\b[^>]*style="[^"]*flex\s*:\s*0\s+0\s+\d+(?:\.\d+)?%[^"]*"[^>]*>)(?=\s*<img\b)/i;
    output = output.replace(imgWrapRe, (imgWrapTag) => {
      // 这里使用 transformStyleAttr 精细压缩 + 设置 margin 方向（TOP → mb，BOTTOM → mt）
      const r = transformStyleAttr(imgWrapTag, (decls) => {
        let local = false;
        // FR-5：若声明了 min-height:0 / overflow / align-items:stretch，保留；否则补齐关键约束
        const flex = getDecl(decls, 'flex');
        if (flex) {
          const newFlex = flex.replace(/0\s+0\s+\d+(?:\.\d+)?%/, `0 0 ${targetPct}%`);
          if (newFlex !== flex) {
            setDecl(decls, 'flex', newFlex);
            local = true;
          }
        } else {
          setDecl(decls, 'flex-basis', `${targetPct}%`);
          setDecl(decls, 'flex-shrink', '0');
          setDecl(decls, 'flex-grow', '0');
          local = true;
        }
        // FR-5 stats-grid 模式：为防包裹缺少关键显示约束，补齐 display:flex / align-items / overflow / min-height
        if (layoutKind === 'stats-grid') {
          const disp = (getDecl(decls, 'display') || '').toLowerCase();
          if (!disp) {
            setDecl(decls, 'display', 'flex');
            local = true;
          }
          const align = getDecl(decls, 'align-items');
          if (!align) {
            setDecl(decls, 'align-items', 'stretch');
            local = true;
          }
          const oh = getDecl(decls, 'overflow');
          if (!oh) {
            setDecl(decls, 'overflow', 'hidden');
            local = true;
          }
          const mh = getDecl(decls, 'min-height');
          if (!mh) {
            setDecl(decls, 'min-height', '0');
            local = true;
          }
        }
        setDecl(decls, marginSide, newMarginVal);
        local = true;
        return local;
      });
      if (r !== imgWrapTag) repaired = true;
      return r;
    });
  }

  // Step 3：li≥5，H2 标题降级紧凑（TOP/BOTTOM 通用）—— stats-grid 不降级（grid 本身横向排布不挤）
  if (layoutKind !== 'stats-grid' && liCount >= 5) {
    output = output.replace(/<h2\b([^>]*)>/i, (m) => {
      const r = tightenH2(m);
      if (r !== m) repaired = true;
      return r;
    });
  }

  // Step 4（极限兜底）：如果 li 特别多 ≥6，给文本区加可滚动
  //   - TOP    → 文本容器（flex:1）在图片之后、紧邻 UL
  //   - BOTTOM → 文本容器在图片之前、紧邻 UL（即 H2 之后第一个 flex:1 div）
  //   我们用相同的前瞻/后顾正则，两种模式都能命中一个 flex:1 容器
  if (layoutKind !== 'stats-grid' && liCount >= 6) {
    // TOP 模式：文本容器在列表前
    let anyHit = false;
    output = output.replace(
      /(<div\b[^>]*style="[^"]*flex\s*:\s*1[^"]*min-height\s*:\s*0[^"]*"[^>]*>)(?=\s*<(ul|ol)\b)/i,
      (full) => {
        const r = transformStyleAttr(full, (decls) => {
          setDecl(decls, 'max-height', '100%');
          setDecl(decls, 'overflow-y', 'auto');
          return true;
        });
        if (r !== full) {
          repaired = true;
          anyHit = true;
        }
        return r;
      },
    );
    // BOTTOM 模式：文本容器在列表之后且紧邻图片容器前也可能需要，这里只要没命中 TOP，
    // 就尝试把"任何包含大量 li 的单列/双列容器的外层"统一处理；上面TOP已兜底且不重复修改（重复调用 transformStyleAttr 是幂等的）
    if (!anyHit && mode === 'bottom') {
      // 找第一个 flex:1 且 min-height:0 的 <div...>（通常就是列表所在文本容器），给它加滚动。
      output = output.replace(
        /(<div\b[^>]*style="[^"]*flex\s*:\s*1[^"]*min-height\s*:\s*0[^"]*"[^>]*>)/i,
        (full) => {
          const r = transformStyleAttr(full, (decls) => {
            setDecl(decls, 'max-height', '100%');
            setDecl(decls, 'overflow-y', 'auto');
            return true;
          });
          if (r !== full) repaired = true;
          return r;
        },
      );
    }
  }

  return repaired ? output : html;
}

