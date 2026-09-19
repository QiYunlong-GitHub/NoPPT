/**
 * AiService 的 HTML 字符串工具（由 ai.service.ts 外置，函数体逐字节搬移）。
 *
 * 这些方法不依赖 AiService 实例状态，因此可作为纯函数独立测试。
 * 行为锁定测试见：__tests__/ai-service-html-utils.test.ts
 */
export function collectImageRefs(html: string): {
  imgs: Array<{ fullMatch: string; src: string }>;
  bgImages: Array<{ fullMatch: string; url: string }>;
} {
  const imgs: Array<{ fullMatch: string; src: string }> = [];
  const imgRegex = /<img[^>]*src\s*=\s*["']([^"']*)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRegex.exec(html)) !== null) {
    const src = m[1]
      .trim()
      .replace(/^`|`$/g, '')
      .trim()
      .replace(/^["']|["']$/g, '')
      .trim();
    if (src) imgs.push({ fullMatch: m[0], src });
  }
  const bgImages: Array<{ fullMatch: string; url: string }> = [];
  const bgRegex = /background-image\s*:\s*[^;]*url\(\s*['"]?([^'")]+)['"]?\s*\)[^;]*;?/gi;
  while ((m = bgRegex.exec(html)) !== null) {
    const url = m[1]
      .trim()
      .replace(/^`|`$/g, '')
      .trim()
      .replace(/^["']|["']$/g, '')
      .trim();
    if (url) bgImages.push({ fullMatch: m[0], url });
  }
  return { imgs, bgImages };
}

export function isLocalAssetUrl(url: string): boolean {
  if (!url) return false;
  if (url.startsWith('data:')) return false;
  if (url.startsWith('#')) return false;
  if (url.startsWith('http://localhost')) return false;
  if (url.includes('NOPPT_IMAGE_PLACEHOLDER') || url.includes('NOPPT_BG_PLACEHOLDER')) return false;
  return url.startsWith('/data/');
}

export function replaceImageUrlInHtml(html: string, oldUrl: string, newUrl: string): string {
  let out = html;
  const imgRegex = /(<img[^>]*src\s*=\s*["'])([^"']*)(["'][^>]*>)/gi;
  out = out.replace(imgRegex, (match, pre, src, post) => {
    if (src.trim() === oldUrl) return pre + newUrl + post;
    return match;
  });
  const bgRegex = /(background-image\s*:\s*[^;]*url\(\s*['"]?)([^'")]+)(['"]?\s*\)[^;]*;?)/gi;
  out = out.replace(bgRegex, (match, pre, url, post) => {
    if (url.trim() === oldUrl) return pre + newUrl + post;
    return match;
  });
  return out;
}

export function mapRatioToSize(ratio: string | undefined, fallback: string | undefined): string {
  if (ratio) {
    const r = ratio.replace(/\s+/g, '');
    if (r === '16:9') return '1792x1024';
    if (r === '4:3') return '1024x1024';
    if (r === '21:9') return '1792x1024';
    if (r === '1:1') return '1024x1024';
  }
  return fallback || '1024x1024';
}

export function extractRatioFromImgTag(fullMatch: string): string | undefined {
  const m = fullMatch.match(/data-image-ratio\s*=\s*["']([^"']+)["']/i);
  return m ? m[1] : undefined;
}

/**
 * B3S：O(N) 裸文本快速探测。命中（有裸文本）返回 true，否则返回 false。
 * 用于 Server 端 ensureSemanticWrapping 的前置短路：
 *   - 无裸文本时直接 return 原 html（避免全量重建引发 style 属性被反复序列化）
 *   - 有裸文本时才跑完整的栈式包裹逻辑
 */
export function _serverHasBareText(html: string): boolean {
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
    'span',
    'strong',
    'em',
    'b',
    'i',
    'u',
    'a',
    'br',
    'font',
    'mark',
    'small',
    'del',
    'ins',
    's',
    'q',
    'abbr',
    'time',
  ]);
  const CONTAINER_TAGS = new Set([
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
    'hgroup',
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
  // 维护"当前帧 inTextCtx"栈：每当 push 一个新容器/文本标签就入栈，弹栈时恢复父上下文
  const ctxStack: boolean[] = [false];
  let i = 0;
  while (i < n) {
    const ch = html[i];
    if (ch !== '<') {
      // 当前上下文：栈顶 inTextCtx；false（容器层）+ 非空白 = 裸文本
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
      // 自闭合标签出现在容器层不算裸文本，是合法内容
      i = tagEnd + 1;
      continue;
    }
    if (!closing) {
      const inTextCtx = TEXT_TAGS.has(tn);
      const isContainer = !inTextCtx && CONTAINER_TAGS.has(tn);
      if (isContainer || inTextCtx) {
        ctxStack.push(inTextCtx);
      } else {
        // 未知标签：视为文本上下文（避免误伤未入表标签）
        ctxStack.push(true);
      }
    } else {
      // 闭合标签：弹栈
      if (ctxStack.length > 1) ctxStack.pop();
    }
    i = tagEnd + 1;
  }
  return false;
}

/**
 * ensureSemanticWrapping —— Server 端与 AI 端等价的裸文本终极兜底
 * （基于栈的深度优先扫描，详见 AI 端同名方法注释）
 *
 * B3S 优化：先 O(N) 快速探测是否存在裸文本——不存在则直接返回原字符串，
 * 避免全量重建 HTML（重建过程会重排 style Map → 字符顺序变化、属性重建，
 * 容易引发下游 sanitize 再序列化时的"属性打架"现象）。
 */
export function ensureSemanticWrapping(html: string): string {
  if (!html) return html;
  // B3S：快速无裸文本短路——99% 的 AI 幻灯片无裸文本，直接原样返回，style 属性不动
  if (!_serverHasBareText(html)) {
    return html;
  }

  const DEFAULT_P_STYLE =
    'font-size:24px;color:#374151;font-weight:600;line-height:2.0;overflow-wrap:break-word;word-break:break-word;';
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
  ]);
  const CONTAINER_TAGS = new Set([
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

  interface StackFrame {
    tagName: string;
    openTagFull: string;
    inTextContext: boolean;
    pendingBare: string;
    isContainer: boolean;
    innerBuffer: string;
  }
  const stack: StackFrame[] = [
    {
      tagName: '__root__',
      openTagFull: '',
      inTextContext: false,
      pendingBare: '',
      isContainer: false,
      innerBuffer: '',
    },
  ];

  const flushBare = (frame: StackFrame) => {
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
        if (top.inTextContext || !top.isContainer) {
          top.innerBuffer += html.slice(i, j);
        } else {
          flushBare(top);
          top.innerBuffer += html.slice(i, j);
        }
        i = j;
        continue;
      }
      if (html.startsWith('<![CDATA[', i)) {
        const end = html.indexOf(']]>', i);
        const j = end === -1 ? n : end + 3;
        stack[stack.length - 1].innerBuffer += html.slice(i, j);
        i = j;
        continue;
      }
      if (html.startsWith('<!', i) || html.startsWith('<?', i)) {
        const end = html.indexOf('>', i);
        const j = end === -1 ? n : end + 1;
        stack[stack.length - 1].innerBuffer += html.slice(i, j);
        i = j;
        continue;
      }
      const tagEnd = html.indexOf('>', i);
      if (tagEnd === -1) {
        const top = stack[stack.length - 1];
        if (top.inTextContext || !top.isContainer) top.innerBuffer += html[i];
        else top.pendingBare += html[i];
        i++;
        continue;
      }
      const tagFull = html.slice(i, tagEnd + 1);
      const tagMatch = tagFull.match(/^<\/?([a-zA-Z0-9]+)/);
      if (!tagMatch) {
        const top = stack[stack.length - 1];
        if (top.inTextContext || !top.isContainer) top.innerBuffer += tagFull;
        else top.pendingBare += tagFull;
        i = tagEnd + 1;
        continue;
      }
      const tagName = tagMatch[1].toLowerCase();
      const isClosing = tagFull[1] === '/';
      const selfClosingSingleton = new Set([
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
      const isSelfClosing = tagFull.endsWith('/>') || selfClosingSingleton.has(tagName);

      if (isSelfClosing) {
        const top = stack[stack.length - 1];
        if (!top.inTextContext && top.isContainer) flushBare(top);
        top.innerBuffer += tagFull;
        i = tagEnd + 1;
        continue;
      }

      if (!isClosing) {
        const top = stack[stack.length - 1];
        if (!top.inTextContext && top.isContainer) flushBare(top);
        const inTextContext = top.inTextContext || TEXT_TAGS.has(tagName);
        const isContainer = !inTextContext && CONTAINER_TAGS.has(tagName);
        stack.push({
          tagName,
          openTagFull: tagFull,
          inTextContext,
          pendingBare: '',
          isContainer,
          innerBuffer: '',
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
          if (top.inTextContext || !top.isContainer) top.innerBuffer += tagFull;
          else top.pendingBare += tagFull;
          i = tagEnd + 1;
          continue;
        }
        const popped = stack.splice(popIdx)[0];
        if (popped.isContainer) flushBare(popped);
        const closing = `</${popped.tagName}>`;
        const assembled = popped.openTagFull + popped.innerBuffer + closing;
        const newTop = stack[stack.length - 1];
        if (!newTop.inTextContext && newTop.isContainer) flushBare(newTop);
        newTop.innerBuffer += assembled;
        i = tagEnd + 1;
        continue;
      }
    } else {
      const top = stack[stack.length - 1];
      if (top.inTextContext || !top.isContainer) {
        top.innerBuffer += html[i];
      } else {
        top.pendingBare += html[i];
      }
      i++;
    }
  }
  while (stack.length > 1) {
    const popped = stack.pop()!;
    if (popped.isContainer) flushBare(popped);
    const assembled =
      popped.openTagFull +
      popped.innerBuffer +
      (popped.tagName !== '__root__' ? `</${popped.tagName}>` : '');
    stack[stack.length - 1].innerBuffer += assembled;
  }
  if (stack[0].isContainer) flushBare(stack[0]);
  return stack[0].innerBuffer;
}
