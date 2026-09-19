
/**
 * 修复卡片强制 height:100% 导致的大面积留白。
 * 在 display:grid 容器中，如果子卡片设置了 height:100%，配合 align-content:stretch
 * 会把卡片强制拉伸到整行高度，内容不足时卡片下半部分全是空白。
 * 这里移除「卡片样式」div（有 border-radius/background/border，且不是 slide 根容器）上的
 * height:100%，让卡片高度由内容自然撑开。
 */
export function removeForcedCardHeight(html: string): string {
  return html.replace(
    /<div\b([^>]*style="[^"]*")([^>]*)>/gi,
    (match: string, stylePart: string, rest: string) => {
      if (!/height\s*:\s*100%/i.test(stylePart)) return match;
      if (!/display\s*:\s*flex/i.test(stylePart)) return match;
      if (!/flex-direction\s*:\s*column/i.test(stylePart)) return match;
      if (/flex\s*:\s*1\b/.test(stylePart)) return match;
      // 排除 slide 根容器：它有 position:relative + overflow:hidden + box-sizing:border-box
      if (/position\s*:\s*relative/i.test(stylePart) && /overflow\s*:\s*hidden/i.test(stylePart))
        return match;
      // 必须是卡片样式：有 border-radius 或 background 或 border
      const looksLikeCard =
        /border-radius\s*:/i.test(stylePart) ||
        /background(?:-color)?\s*:/i.test(stylePart) ||
        /border\s*:/i.test(stylePart);
      if (!looksLikeCard) return match;
      const newStyle = stylePart.replace(/style="([^"]*)"/i, (_s: string, css: string) => {
        const cleaned = css
          .replace(/(^|;)\s*height\s*:\s*100%\s*(?=;|$)/i, '$1')
          .replace(/;;+/g, ';')
          .replace(/^;\s*/, '')
          .replace(/;\s*$/, '');
        return `style="${cleaned}"`;
      });
      return `<div${newStyle}${rest}>`;
    },
  );
}


/**
 * B3L 专用：O(N) 裸文本快速探测（与 Server 端 _serverHasBareText 等价）。
 * 无裸文本 → enforceBareTextToParagraphs 直接 return 原字符串，不重建 style。
 */
export function _coreHasBareText(html: string): boolean {
  const TEXT_TAGS = new Set([
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'p',
    'li',
    'figcaption',
    'td',
    'th',
    'label',
    'button',
    'pre',
    'code',
    'blockquote',
    'sup',
    'sub',
    'textarea',
    'option',
    'title',
    'style',
    'script',
    'noscript',
    'a',
    'span',
    'strong',
    'em',
    'b',
    'i',
    'u',
    's',
    'small',
    'mark',
    'abbr',
    'cite',
    'del',
    'ins',
    'kbd',
    'q',
    'samp',
    'var',
    'time',
    'font',
  ]);
  const SELF_CLOSING = new Set([
    'br',
    'img',
    'hr',
    'input',
    'meta',
    'link',
    'wbr',
    'area',
    'base',
    'col',
    'embed',
    'source',
    'track',
  ]);
  const n = html.length;
  const ctxStack: boolean[] = [false];
  let i = 0;
  while (i < n) {
    const ch = html[i];
    if (ch !== '<') {
      if (!ctxStack[ctxStack.length - 1] && !/\s/.test(ch)) return true;
      i++;
      continue;
    }
    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (html.startsWith('<![CDATA[', i)) {
      const end = html.indexOf(']]>', i);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (html.startsWith('<!', i) || html.startsWith('<?', i)) {
      const end = html.indexOf('>', i);
      i = end === -1 ? n : end + 1;
      continue;
    }
    const tagEnd = html.indexOf('>', i);
    if (tagEnd === -1) {
      i++;
      continue;
    }
    const tagFull = html.slice(i, tagEnd + 1);
    const tm = tagFull.match(/^<\/?([a-zA-Z0-9]+)/);
    if (!tm) {
      i = tagEnd + 1;
      continue;
    }
    const tn = tm[1].toLowerCase();
    const closing = tagFull[1] === '/';
    const selfCls = tagFull.endsWith('/>') || SELF_CLOSING.has(tn);
    if (selfCls) {
      i = tagEnd + 1;
      continue;
    }
    if (!closing) {
      const clsMatch = tagFull.match(/class="([^"]*)"/i);
      const isNopptText = clsMatch && /\bnoppt-text-element\b/.test(clsMatch[1]);
      const inTextCtx = TEXT_TAGS.has(tn) || !!isNopptText;
      ctxStack.push(inTextCtx);
    } else {
      if (ctxStack.length > 1) ctxStack.pop();
    }
    i = tagEnd + 1;
  }
  return false;
}


/**
 * enforceBareTextToParagraphs —— 裸文本终级兜底（栈式深度优先扫描）。
 *
 * 任何进入 normalizeAISlide 的 slide.html，在离开之前都会过这一关：
 *   - 位于 div/section/article 等"布局容器"直接子位置的可见字符（未被
 *     p/li/h1~h6 等"文本容器"包裹）一律被识别为"裸文本"。
 *   - 按照换行拆分、trim 后非空的行，各自包装成带默认样式的 <p> 标签。
 *
 * 这是整个演示文稿生成链路中的"最后一公里"。即使上游 AI 端和 Server 端
 * 的各种 sanitize 都因为某种路径没被触发，这里是 LayoutEngine 层的统一
 * 出口，保证写入 JSON 的 HTML 不会出现"大片空白 + 无法选择的裸字"。
 *
 * B3L 优化：前置 O(N) 无裸文本短路 → 99% AI 返回直接 return 原字符串，
 * 避免全量重建导致 style 属性被序列化再重建。
 */
export function enforceBareTextToParagraphs(html: string): string {
  if (!html) return html;
  // B3L：无裸文本直接返回，不动 style
  if (!_coreHasBareText(html)) return html;
  const DEFAULT_P_STYLE =
    'font-size:24px;color:#374151;font-weight:600;line-height:2.0;overflow-wrap:break-word;word-break:break-word;';
  // 判断：一个开标签里的 style 是否足以证明它是 Badge/胶囊 容器
  const isBadgeStyle = (openTagFull: string): boolean => {
    const sm = openTagFull.match(/style="([^"]*)"/i);
    if (!sm) return false;
    const s = sm[1];
    const has = (r: RegExp) => r.test(s);
    const score = [
      has(/display\s*:\s*(?:inline-flex|flex)\b/i),
      has(/padding\s*:[^;]*(?:1[0-9]px\s+2[0-9]px|10px\s+28px|12px\s+24px)\b/i),
      has(/border-radius\s*:[^;]*999px/i),
      has(
        /background\s*:[^;]*(?:#[0-9a-f]{6,8}1[0-9a-f]|rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\.0[5-9])/i,
      ),
    ].filter(Boolean).length;
    return score >= 3;
  };
  const TEXT_TAGS = new Set<string>([
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'p',
    'li',
    'figcaption',
    'td',
    'th',
    'label',
    'button',
    'pre',
    'code',
    'blockquote',
    'sup',
    'sub',
    'textarea',
    'option',
    'title',
    'style',
    'script',
    'noscript',
    'a',
    'span',
    'strong',
    'em',
    'b',
    'i',
    'u',
    's',
    'small',
    'mark',
    'abbr',
    'cite',
    'del',
    'ins',
    'kbd',
    'q',
    'samp',
    'var',
  ]);
  const CONTAINER_TAGS = new Set<string>([
    'div',
    'section',
    'article',
    'aside',
    'nav',
    'main',
    'header',
    'footer',
    'body',
    'figure',
    'ul',
    'ol',
    'table',
    'thead',
    'tbody',
    'tfoot',
    'tr',
    'form',
    'details',
    'summary',
  ]);
  const SINGLETON = new Set<string>([
    'br',
    'img',
    'hr',
    'input',
    'meta',
    'link',
    'wbr',
    'area',
    'base',
    'col',
    'embed',
    'source',
    'track',
  ]);

  const isNopptTextElement = (tagFull: string): boolean => {
    const clsMatch = tagFull.match(/class="([^"]*)"/i);
    if (!clsMatch) return false;
    return /\bnoppt-text-element\b/.test(clsMatch[1]);
  };

  interface Frame {
    tagName: string;
    openTagFull: string;
    inTextContext: boolean;
    pendingBare: string;
    isContainer: boolean;
    innerBuffer: string;
    isBadgeContainer: boolean;
  }
  const stack: Frame[] = [
    {
      tagName: '__root__',
      openTagFull: '',
      inTextContext: false,
      pendingBare: '',
      isContainer: false,
      innerBuffer: '',
      isBadgeContainer: false,
    },
  ];
  const flushBare = (frame: Frame) => {
    if (!frame.pendingBare) return;
    const lines = frame.pendingBare.split(/\r?\n/);
    let generated = '';
    for (const raw of lines) {
      const t = raw.trim();
      if (!t) continue;
      generated += `<p style="margin:0;${DEFAULT_P_STYLE}">${t}</p>`;
    }
    frame.innerBuffer += generated;
    frame.pendingBare = '';
  };
  let i = 0;
  const n = html.length;
  while (i < n) {
    if (html[i] === '<') {
      if (html.startsWith('<!--', i)) {
        const end = html.indexOf('-->', i);
        const j = end === -1 ? n : end + 3;
        const top = stack[stack.length - 1];
        if (top.inTextContext || !top.isContainer || top.isBadgeContainer)
          top.innerBuffer += html.slice(i, j);
        else {
          flushBare(top);
          top.innerBuffer += html.slice(i, j);
        }
        i = j;
        continue;
      }
      if (html.startsWith('<![CDATA[', i) || html.startsWith('<!', i) || html.startsWith('<?', i)) {
        const end = html.indexOf('>', i);
        const j = end === -1 ? n : end + 1;
        stack[stack.length - 1].innerBuffer += html.slice(i, j);
        i = j;
        continue;
      }
      const tagEnd = html.indexOf('>', i);
      if (tagEnd === -1) {
        const top = stack[stack.length - 1];
        if (top.inTextContext || !top.isContainer || top.isBadgeContainer)
          top.innerBuffer += html[i];
        else top.pendingBare += html[i];
        i++;
        continue;
      }
      const tagFull = html.slice(i, tagEnd + 1);
      const tagMatch = tagFull.match(/^<\/?([a-zA-Z0-9]+)/);
      if (!tagMatch) {
        const top = stack[stack.length - 1];
        if (top.inTextContext || !top.isContainer || top.isBadgeContainer)
          top.innerBuffer += tagFull;
        else top.pendingBare += tagFull;
        i = tagEnd + 1;
        continue;
      }
      const tagName = tagMatch[1].toLowerCase();
      const isClosing = tagFull[1] === '/';
      const isSelfClosing = tagFull.endsWith('/>') || SINGLETON.has(tagName);
      if (isSelfClosing) {
        const top = stack[stack.length - 1];
        if (!top.inTextContext && !top.isBadgeContainer && top.isContainer) flushBare(top);
        top.innerBuffer += tagFull;
        i = tagEnd + 1;
        continue;
      }
      if (!isClosing) {
        const top = stack[stack.length - 1];
        if (!top.inTextContext && !top.isBadgeContainer && top.isContainer) flushBare(top);
        const badged = isBadgeStyle(tagFull);
        const isNopptText = isNopptTextElement(tagFull);
        const inTextContext =
          top.inTextContext ||
          TEXT_TAGS.has(tagName) ||
          badged ||
          top.isBadgeContainer ||
          isNopptText;
        const isContainer = !inTextContext && CONTAINER_TAGS.has(tagName);
        stack.push({
          tagName,
          openTagFull: tagFull,
          inTextContext,
          pendingBare: '',
          isContainer,
          innerBuffer: '',
          isBadgeContainer: badged || top.isBadgeContainer,
        });
        i = tagEnd + 1;
        continue;
      } else {
        let popIdx = -1;
        for (let k = stack.length - 1; k >= 1; k--) {
          if (stack[k].tagName === tagName) {
            popIdx = k;
            break;
          }
        }
        if (popIdx === -1) {
          const top = stack[stack.length - 1];
          if (top.inTextContext || !top.isContainer || top.isBadgeContainer)
            top.innerBuffer += tagFull;
          else top.pendingBare += tagFull;
          i = tagEnd + 1;
          continue;
        }
        const popped = stack.splice(popIdx)[0];
        if (popped.isContainer && !popped.isBadgeContainer) flushBare(popped);
        const closing = `</${popped.tagName}>`;
        const assembled = popped.openTagFull + popped.innerBuffer + closing;
        const newTop = stack[stack.length - 1];
        if (!newTop.inTextContext && !newTop.isBadgeContainer && newTop.isContainer)
          flushBare(newTop);
        newTop.innerBuffer += assembled;
        i = tagEnd + 1;
        continue;
      }
    } else {
      const top = stack[stack.length - 1];
      // Badge 容器永远视为文本安全上下文，字符直接 innerBuffer 不包 p
      if (top.inTextContext || top.isBadgeContainer || !top.isContainer) top.innerBuffer += html[i];
      else top.pendingBare += html[i];
      i++;
    }
  }
  while (stack.length > 1) {
    const popped = stack.pop()!;
    if (popped.isContainer && !popped.isBadgeContainer) flushBare(popped);
    const assembled =
      popped.openTagFull +
      popped.innerBuffer +
      (popped.tagName !== '__root__' ? `</${popped.tagName}>` : '');
    stack[stack.length - 1].innerBuffer += assembled;
  }
  if (stack[0].isContainer) flushBare(stack[0]);
  return stack[0].innerBuffer;
}

/* ============================================================================
 * preventContentImageTopOverflow —— 最终兜底（LayoutEngine 层溢出防御）
 *
 * 目标：修复"上图下文（content-image-top）+ 单列长列表 + 卡片大 padding"
 *       组合导致的标题和列表内容超出 1280×720 可视区域问题。
 *
 * 检测模式（同时满足才修复，避免误伤左图右文/其他布局）：
 *   ① H2 存在 → ② 紧随一个含 <img> 且样式含 flex:0 0 XX% 的 div（图片包裹）
 *             → ③ 随后有文本 div 内含 UL/OL 且为 flex-direction:column（单列）
 *             → ④ 该列表内 li 标签数 ≥ 3（3 个以上才有高度压缩必要）
 *
 * 修复阶梯（按优先级逐层施加）：
 *   Step 1：li≥4 时，列表单列 flex → 双列 Grid；同时 li padding/字号/icon 降级紧凑
 *   Step 2：按 li 数量压缩图片容器高度（48%→40%/35%/32%）、缩小 margin-bottom
 *   Step 3：li≥5 时，H2 标题紧凑（font/margin/line-height 降级）
 *   Step 4：极限兜底，内层文本容器增加 max-height + overflow-y:auto（可视不裁切）
 * ========================================================================== */

