import { parseStyleDeclarations } from '@noppt/core';

/**
 * PostProcess DOM 簇（从 html-presentation-agent.ts 外置）。
 * 纯函数，无 this 依赖；agent 中对应方法改为「薄委托」保留在原型上。
 */

export function composeInheritedPStyle(parentStyle?: string): string {
  if (!parentStyle)
    return 'font-size:24px;color:#374151;font-weight:600;line-height:2.0;overflow-wrap:break-word;word-break:break-word;';
  const grab = (re: RegExp): string | undefined => {
    const m = re.exec(parentStyle);
    return m ? m[1].trim() : undefined;
  };
  const fs = grab(/font-size\s*:\s*([^;"}]+)/i);
  const fc = grab(/(?:^|[^-])color\s*:\s*([^;"}]+)/i);
  const ls = grab(/letter-spacing\s*:\s*([^;"}]+)/i);
  const lh = grab(/line-height\s*:\s*([^;"}]+)/i);
  const fw = grab(/font-weight\s*:\s*([^;"}]+)/i);
  const parts = ['margin:0;'];
  if (fs) parts.push(`font-size:${fs};`);
  if (fc) parts.push(`color:${fc};`);
  if (ls) parts.push(`letter-spacing:${ls};`);
  if (lh) parts.push(`line-height:${lh};`);
  if (fw) parts.push(`font-weight:${fw};`);
  return parts.length > 1
    ? parts.join('')
    : 'font-size:24px;color:#374151;font-weight:600;line-height:2.0;overflow-wrap:break-word;word-break:break-word;';
}

export function ensureSemanticWrapping(html: string): string {
  if (!html) return html;
  // "文本安全容器"——进入这些标签内部后，内部字符不再视为裸文本。
  // 注意：这里不包含 span/a/strong 等 inline，因为它们作为"裸文本字符"处理时，
  // inline 标签本身会被拼入裸文本缓冲（和相邻字符一起包一层 p）。
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
  // "布局容器"——它们的**直接子节点中出现的可见字符** = 裸文本，必须处理
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
    openTagFull: string; // 原始的开标签字符串（含属性），最后拼回去
    inTextContext: boolean; // 该 frame 本身或其祖先中存在 text 标签 → 全局 text 上下文
    pendingBare: string; // 累积的裸文本缓冲（仅当 frame.isContainer 时有用）
    isContainer: boolean; // 是否 CONTAINER_TAGS 之一（决定是否要在弹栈时处理 pendingBare）
    innerBuffer: string; // 已经处理完的子内容（用于在弹栈时一次性组装：openTag + processedContent + closeTag）
    isBadgeContainer: boolean; // === 修复 D：该容器本身就是 Badge/胶囊（inline-flex+padding+radius 999px），内部字符视为安全文本，不包 p
  }

  // 判断：一个开标签里的 style 是否足以证明它就是"Badge/胶囊 容器"
  const isBadgeStyle = (openTagFull: string): boolean => {
    const sm = openTagFull.match(/style="([^"]*)"/i);
    if (!sm) return false;
    const s = sm[1];
    const hasInlineFlex = /display\s*:\s*(?:inline-flex|flex)\b/i.test(s);
    const hasBadgePadding =
      /padding\s*:[^;]*(?:1[0-9]px\s+2[0-9]px|10px\s+28px|12px\s+24px)\b/i.test(s);
    const hasRadius999 = /border-radius\s*:[^;]*999px/i.test(s);
    const hasBgTint =
      /background\s*:[^;]*(?:#[0-9a-f]{6,8}1[0-9a-f]|rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\.0[5-9])/i.test(
        s,
      );
    // 命中 3/4 以上特征，认定是 Badge 容器（避免误判普通 flex div）
    const score = [hasInlineFlex, hasBadgePadding, hasRadius999, hasBgTint].filter(
      Boolean,
    ).length;
    return score >= 3;
  };

  // 准备栈，先塞一个"根虚拟帧"
  const stack: StackFrame[] = [
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

  // flushBare: 把当前帧的 pendingBare 处理成若干 <p>，append 到当前帧的 innerBuffer
  // 保真度修复：<p> 从父容器继承字号/颜色/字距/行高/字重（若父容器带显式排版属性），
  // 仅在无任何可继承信息时回落 DEFAULT_P_STYLE，避免写死 24px/2.0/#374151 覆盖原设计。
  const flushBare = (frame: StackFrame) => {
    if (!frame.pendingBare) return;
    // 拆分：按换行；每行 trim 后非空 → 包一层 <p>；空行丢弃（视觉上等于没内容）
    const lines = frame.pendingBare.split(/\r?\n/);
    const pStyle = composeInheritedPStyle(frame.openTagFull);
    let generated = '';
    for (const raw of lines) {
      const t = raw.trim();
      if (!t) continue;
      // 如果这一行里本身就带 <img>/<span>/<strong> 等 inline 元素，直接整行拼进 <p> 内部
      generated += `<p style="${pStyle}">${t}</p>`;
    }
    frame.innerBuffer += generated;
    frame.pendingBare = '';
  };

  let i = 0;
  const n = html.length;
  while (i < n) {
    if (html[i] === '<') {
      // ———— 分支 A：HTML 标签 / 注释 / CDATA / DOCTYPE ————
      // A0. 2025-07 R3 P2 修复：<svg...> 整块视为「原始保留区」，不入栈、不包 p、不做裸文本处理。
      //     SVG 子元素（<line>/<path>/<circle> 等）如果被 ensureSemanticWrapping 按容器裸文本
      //     判定 → 会被包一层 DEFAULT_P_STYLE <p>，Slide-03 卡片会因此出现大量畸形嵌套 + 空节点。
      //     直接取 `</svg>` 闭位置，整段原样 append 到当前帧 innerBuffer 后 i 跳过去。
      if (/^<svg[\s>]/i.test(html.slice(i, i + 20))) {
        const lower = html.toLowerCase();
        const openTagEnd = lower.indexOf('>', i);
        if (openTagEnd === -1) {
          i++;
          continue;
        }
        // self-closing <svg ... />（极少见，但防御）
        if (html[openTagEnd - 1] === '/') {
          const top = stack[stack.length - 1];
          if (!top.inTextContext && !top.isBadgeContainer && top.isContainer) flushBare(top);
          top.innerBuffer += html.slice(i, openTagEnd + 1);
          i = openTagEnd + 1;
          continue;
        }
        const closeTag = '</svg>';
        let depth = 1;
        let pos = openTagEnd + 1;
        while (pos < lower.length && depth > 0) {
          const nextOpen = lower.indexOf('<svg', pos);
          const nextClose = lower.indexOf(closeTag, pos);
          if (nextClose === -1) break;
          if (nextOpen !== -1 && nextOpen < nextClose) {
            const after = lower.indexOf('>', nextOpen);
            if (after !== -1 && lower[after - 1] !== '/') depth++;
            pos = after === -1 ? nextClose + closeTag.length : after + 1;
          } else {
            depth--;
            if (depth === 0) {
              const blockEnd = nextClose + closeTag.length;
              const top = stack[stack.length - 1];
              if (!top.inTextContext && !top.isBadgeContainer && top.isContainer) flushBare(top);
              top.innerBuffer += html.slice(i, blockEnd);
              i = blockEnd;
              break;
            }
            pos = nextClose + closeTag.length;
          }
        }
        // 没找到配对（depth 还 >0）兜底：只把开标签当文本字符处理（避免死循环）
        if (depth > 0) {
          const top = stack[stack.length - 1];
          if (top.inTextContext || !top.isContainer) top.innerBuffer += html[i];
          else top.pendingBare += html[i];
          i++;
        }
        continue;
      }
      // A1. 注释 <!-- -->
      if (html.startsWith('<!--', i)) {
        const end = html.indexOf('-->', i);
        const j = end === -1 ? n : end + 3;
        const top = stack[stack.length - 1];
        if (top.inTextContext || !top.isContainer) {
          top.innerBuffer += html.slice(i, j);
        } else {
          // 容器内的注释：先 flush 累积的裸文本，注释作为 block 直接 append 到 innerBuffer
          flushBare(top);
          top.innerBuffer += html.slice(i, j);
        }
        i = j;
        continue;
      }
      // A2. CDATA
      if (html.startsWith('<![CDATA[', i)) {
        const end = html.indexOf(']]>', i);
        const j = end === -1 ? n : end + 3;
        stack[stack.length - 1].innerBuffer += html.slice(i, j);
        i = j;
        continue;
      }
      // A3. <!DOCTYPE / <?xml 等
      if (html.startsWith('<!', i) || html.startsWith('<?', i)) {
        const end = html.indexOf('>', i);
        const j = end === -1 ? n : end + 1;
        stack[stack.length - 1].innerBuffer += html.slice(i, j);
        i = j;
        continue;
      }
      // A4. 正规标签：找到 tagEnd，解析 tagName、isClosing、isSelfClosing
      const tagEnd = html.indexOf('>', i);
      if (tagEnd === -1) {
        // 无结尾 '>'，视为普通字符
        const top = stack[stack.length - 1];
        if (top.inTextContext || !top.isContainer) top.innerBuffer += html[i];
        else top.pendingBare += html[i];
        i++;
        continue;
      }
      const tagFull = html.slice(i, tagEnd + 1);
      const tagMatch = tagFull.match(/^<\/?([a-zA-Z0-9]+)/);
      if (!tagMatch) {
        // 不认识的 <xxx>（非正常 tag 名字）→ 视为文本
        const top = stack[stack.length - 1];
        if (top.inTextContext || !top.isContainer) top.innerBuffer += tagFull;
        else top.pendingBare += tagFull;
        i = tagEnd + 1;
        continue;
      }
      const tagName = tagMatch[1].toLowerCase();
      const isClosing = tagFull[1] === '/';
      // self-closing：显式写成 />，或单例标签
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
        // self-closing：若在容器内，先把已有的裸文本 flush，再追加该元素
        if (!top.inTextContext && top.isContainer) {
          flushBare(top);
        }
        top.innerBuffer += tagFull;
        i = tagEnd + 1;
        continue;
      }

      if (!isClosing) {
        // ———— 开标签：压栈 ————
        const top = stack[stack.length - 1];
        // 进入新标签前：如当前处于"容器内且有裸文本"，先 flush
        if (!top.inTextContext && !top.isBadgeContainer && top.isContainer) {
          flushBare(top);
        }
        // === 修复 D：Badge 容器本身视作 text 上下文（不包 p），且也不是"需处理裸文本的容器" ===
        const badged = isBadgeStyle(tagFull);
        const inTextContext =
          top.inTextContext || TEXT_TAGS.has(tagName) || badged || top.isBadgeContainer;
        const isContainer = !inTextContext && CONTAINER_TAGS.has(tagName);
        const frame: StackFrame = {
          tagName,
          openTagFull: tagFull,
          inTextContext,
          pendingBare: '',
          isContainer,
          innerBuffer: '',
          isBadgeContainer: badged || top.isBadgeContainer, // 子节点也继承 Badge 上下文（防 badge 内再嵌套容器又误包 p）
        };
        stack.push(frame);
        i = tagEnd + 1;
        continue;
      } else {
        // ———— 关标签：弹栈并组装内容 ————
        // 找到匹配的栈帧（最近的 tagName 相同的 frame；若没找到就只跳过当前 tagFull）
        let popIdx = -1;
        for (let k = stack.length - 1; k >= 1; k--) {
          if (stack[k].tagName === tagName) {
            popIdx = k;
            break;
          }
        }
        if (popIdx === -1) {
          // 无匹配的开标签：把关标签当作普通字符处理
          const top = stack[stack.length - 1];
          if (top.inTextContext || !top.isContainer) top.innerBuffer += tagFull;
          else top.pendingBare += tagFull;
          i = tagEnd + 1;
          continue;
        }
        // 弹出 popIdx 之后的所有 frame（嵌套不一致时尽力而为保留内容）
        const popped = stack.splice(popIdx)[0];
        // 弹栈前先 flush 该 frame 里累积的裸文本
        if (popped.isContainer && !popped.isBadgeContainer) flushBare(popped);
        // 组装：openTagFull + 已处理的 innerBuffer + 关标签
        const closing = `</${popped.tagName}>`;
        const assembled = popped.openTagFull + popped.innerBuffer + closing;
        // 把组装结果 append 到新的栈顶
        const newTop = stack[stack.length - 1];
        if (!newTop.inTextContext && !newTop.isBadgeContainer && newTop.isContainer) {
          // 上层也是容器：裸文本先 flush 再 append block
          flushBare(newTop);
        }
        newTop.innerBuffer += assembled;
        i = tagEnd + 1;
        continue;
      }
    } else {
      // ———— 分支 B：普通文本字符 ————
      const top = stack[stack.length - 1];
      // === 修复 D：Badge 容器内的字符永远当安全文本（不进 pendingBare，不包 p） ===
      if (top.inTextContext || top.isBadgeContainer || !top.isContainer) {
        top.innerBuffer += html[i];
      } else {
        // 当前帧是"容器"且不在 text 上下文 → 字符视为裸文本
        top.pendingBare += html[i];
      }
      i++;
    }
  }
  // 循环结束：还留在栈里的 frame（标签匹配不完整时的兜底）→ 全部逐级合入根
  while (stack.length > 1) {
    const popped = stack.pop()!;
    if (popped.isContainer) flushBare(popped);
    const assembled =
      popped.openTagFull +
      popped.innerBuffer +
      (popped.tagName !== '__root__' ? `</${popped.tagName}>` : '');
    stack[stack.length - 1].innerBuffer += assembled;
  }
  // 最后处理 root 的残余裸文本（理论上不该发生，但兜底以防万一）
  if (stack[0].isContainer) flushBare(stack[0]);
  return stack[0].innerBuffer;
}

export function findClosingTagIndex(html: string, tagName: string): number {
  const lower = html.toLowerCase();
  const openTag = `<${tagName.toLowerCase()}`;
  const closeTag = `</${tagName.toLowerCase()}>`;
  let depth = 0;
  const firstOpen = lower.indexOf(openTag);
  if (firstOpen === -1) return -1;
  let i = lower.indexOf('>', firstOpen) + 1;
  depth = 1;
  while (i < lower.length && depth > 0) {
    const nextOpen = lower.indexOf(openTag, i);
    const nextClose = lower.indexOf(closeTag, i);
    if (nextClose === -1) break;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      const tagEnd = lower.indexOf('>', nextOpen);
      if (lower[tagEnd - 1] !== '/') depth++;
      i = tagEnd + 1;
    } else {
      depth--;
      if (depth === 0) return nextClose;
      i = nextClose + closeTag.length;
    }
  }
  return -1;
}

export function findDirectChildElements(
  html: string,
): Array<{ tagName: string; styleAttr: string | null; innerPreview: string | null }> {
  const result: Array<{
    tagName: string;
    styleAttr: string | null;
    innerPreview: string | null;
  }> = [];
  if (!html) return result;
  const SINGLETON = new Set([
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
  let i = 0;
  while (i < n) {
    if (html[i] !== '<') {
      i++;
      continue;
    }
    // 跳过注释
    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i);
      i = end === -1 ? n : end + 3;
      continue;
    }
    // 跳过 CDATA / DOCTYPE / <?xml 等
    if (html.startsWith('<![CDATA[', i) || html.startsWith('<!', i) || html.startsWith('<?', i)) {
      const end = html.indexOf('>', i);
      i = end === -1 ? n : end + 1;
      continue;
    }
    const tagEnd = html.indexOf('>', i);
    if (tagEnd === -1) break;
    const tagFull = html.slice(i, tagEnd + 1);
    // 只处理顶层打开标签（闭合标签直接跳过不加入 result）
    if (tagFull[1] === '/') {
      i = tagEnd + 1;
      continue;
    }
    const tagMatch = tagFull.match(/^<\s*([a-zA-Z0-9]+)/);
    if (!tagMatch) {
      i = tagEnd + 1;
      continue;
    }
    const tagName = tagMatch[1].toLowerCase();
    const isSelfClosing = tagFull.endsWith('/>') || SINGLETON.has(tagName);
    // 提取 style 属性（若无则 null）
    const styleMatch = tagFull.match(/\sstyle\s*=\s*"([^"]*)"/i);
    const styleAttr = styleMatch ? styleMatch[1] : null;
    let innerPreview: string | null = null;
    if (isSelfClosing) {
      result.push({ tagName, styleAttr, innerPreview: null });
      i = tagEnd + 1;
      continue;
    }
    // 找匹配闭合（只截取内部 preview，不遍历孙节点）
    // 使用 findClosingTagIndex 的思路，但从 i 开始，depth=1
    const openTagSeq = `<${tagName}`;
    const closeTagSeq = `</${tagName}>`;
    const lower = html.toLowerCase();
    let depth = 1;
    let j = tagEnd + 1;
    let closeIdx = -1;
    const previewStart = tagEnd + 1;
    while (j < n && depth > 0) {
      const no = lower.indexOf(openTagSeq, j);
      const nc = lower.indexOf(closeTagSeq, j);
      if (nc === -1) break;
      if (no !== -1 && no < nc) {
        const te = lower.indexOf('>', no);
        if (te !== -1 && lower[te - 1] !== '/' && !SINGLETON.has(tagName)) {
          // 必须是与 tagName 完全相同的（用 <tagName xxx> 精确匹配，非子串）
          const reExact = new RegExp(`^<${tagName.toLowerCase()}(\\s|>|/)`, 'i');
          if (reExact.test(lower.substring(no))) depth++;
        }
        j = te === -1 ? nc : te + 1;
      } else {
        depth--;
        if (depth === 0) {
          closeIdx = nc;
          break;
        }
        j = nc + closeTagSeq.length;
      }
    }
    if (closeIdx >= 0) {
      const innerLen = Math.min(closeIdx - previewStart, 300);
      innerPreview = innerLen > 0 ? html.substring(previewStart, previewStart + innerLen) : '';
      // 直接子节点处理完成，跳到闭合之后继续处理下一个兄弟
      i = closeIdx + closeTagSeq.length;
    } else {
      // 找不到闭合，兜底：截取 previewStart 后 300 字符作为预览
      innerPreview = html.substring(previewStart, Math.min(previewStart + 300, n));
      i = tagEnd + 1;
    }
    result.push({ tagName, styleAttr, innerPreview });
  }
  return result;
}

export function wrapTextNodes(html: string): string {
  let result = html;
  const processContainer = (content: string, parentStyle?: string): string => {
    const segments: Array<{ type: 'text' | 'block' | 'inline'; content: string }> = [];
    let buffer = '';
    let i = 0;
    while (i < content.length) {
      if (content[i] === '<') {
        // ===== 新增：优先识别注释块 <!---->、CDATA <![CDATA[...]]>、DOCTYPE/XML 声明 <!...> =====
        // 这些"非正规 tag"被识别为独立 block segment，不进入文本缓冲，避免污染/打断裸文本行
        if (content.startsWith('<!--', i)) {
          const endIdx = content.indexOf('-->', i);
          const j = endIdx === -1 ? content.length : endIdx + 3;
          if (buffer.trim()) {
            segments.push({ type: 'text', content: buffer });
            buffer = '';
          }
          segments.push({ type: 'block', content: content.slice(i, j) });
          i = j;
          continue;
        }
        if (content.startsWith('<![CDATA[', i)) {
          const endIdx = content.indexOf(']]>', i);
          const j = endIdx === -1 ? content.length : endIdx + 3;
          if (buffer.trim()) {
            segments.push({ type: 'text', content: buffer });
            buffer = '';
          }
          segments.push({ type: 'block', content: content.slice(i, j) });
          i = j;
          continue;
        }
        if (content.startsWith('<!', i)) {
          const endIdx = content.indexOf('>', i);
          const j = endIdx === -1 ? content.length : endIdx + 1;
          if (buffer.trim()) {
            segments.push({ type: 'text', content: buffer });
            buffer = '';
          }
          segments.push({ type: 'block', content: content.slice(i, j) });
          i = j;
          continue;
        }
        // ===== 注释识别结束 =====
        const tagEnd = content.indexOf('>', i);
        if (tagEnd === -1) {
          buffer += content.slice(i);
          break;
        }
        const tagFull = content.slice(i, tagEnd + 1);
        const tagMatch = tagFull.match(/^<\/?([a-zA-Z0-9]+)/);
        if (!tagMatch) {
          buffer += content[i];
          i++;
          continue;
        }
        const tagName = tagMatch[1].toLowerCase();
        const isClosing = tagFull[1] === '/';
        const isSelfClosing =
          tagFull[tagFull.length - 2] === '/' || ['br', 'img', 'hr', 'input'].includes(tagName);
        const isInline = [
          'span',
          'strong',
          'em',
          'b',
          'i',
          'u',
          'a',
          'br',
          'sup',
          'sub',
          'font',
        ].includes(tagName);
        const isBlock = [
          'h1',
          'h2',
          'h3',
          'h4',
          'h5',
          'h6',
          'p',
          'ul',
          'ol',
          'li',
          'div',
          'section',
          'article',
          'table',
          'blockquote',
          'img',
          'video',
          'figure',
          'figcaption',
          'pre',
          'code',
        ].includes(tagName);
        if (isInline || isSelfClosing) {
          if (isSelfClosing && !isInline) {
            if (buffer.trim()) {
              segments.push({ type: 'text', content: buffer });
              buffer = '';
            }
            segments.push({ type: 'block', content: tagFull });
          } else {
            buffer += tagFull;
          }
          i = tagEnd + 1;
        } else if (isBlock && !isClosing) {
          let depth = 1,
            j = tagEnd + 1;
          while (j < content.length && depth > 0) {
            if (content[j] === '<') {
              // ===== 新增：嵌套匹配时也要跳过注释 =====
              if (content.startsWith('<!--', j)) {
                const endIdx = content.indexOf('-->', j);
                j = endIdx === -1 ? content.length : endIdx + 3;
                continue;
              }
              const nt = content.indexOf('>', j);
              if (nt === -1) break;
              const nm = content.slice(j, nt + 1).match(/^<\/?([a-zA-Z0-9]+)/);
              if (nm && nm[1].toLowerCase() === tagName) {
                if (content[j + 1] === '/') depth--;
                else if (content[nt - 1] !== '/') depth++;
              }
              j = nt + 1;
            } else j++;
          }
          if (buffer.trim()) {
            segments.push({ type: 'text', content: buffer });
            buffer = '';
          }
          segments.push({ type: 'block', content: content.slice(i, j) });
          i = j;
        } else if (isBlock && isClosing) {
          if (buffer.trim()) {
            segments.push({ type: 'text', content: buffer });
            buffer = '';
          }
          segments.push({ type: 'block', content: tagFull });
          i = tagEnd + 1;
        } else {
          buffer += tagFull;
          i = tagEnd + 1;
        }
      } else {
        buffer += content[i];
        i++;
      }
    }
    if (buffer.trim()) segments.push({ type: 'text', content: buffer });
    // ===== 增强：裸文本缓冲按换行拆分，每行独立包裹 <p> =====
    // 原来：多行裸文本合并成一个 <p> → 内部换行丢失，视觉上堆叠在一起
    // 现在：每行（trim 后非空）单独生成一个 <p>，模拟"每行要点"的呈现效果
    return segments
      .map((seg) => {
        if (seg.type === 'text' && seg.content.trim()) {
          const lines = seg.content.split(/\r?\n/);
          const wrapped: string[] = [];
          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line) continue;
            wrapped.push(`<p style="${composeInheritedPStyle(parentStyle)}">${line}</p>`);
          }
          return wrapped.join('');
        }
        return seg.content;
      })
      .join('');
  };
  const replaceTextInDiv = (htmlStr: string): string => {
    const divRegex = /<(div|section|article)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
    let iterations = 0;
    do {
      const before = htmlStr;
      htmlStr = htmlStr.replace(divRegex, (match, tag, attrs, innerContent) => {
        const styleAttr = (attrs || '').match(/style="([^"]*)"/i);
        const parentStyle = styleAttr ? styleAttr[1] : undefined;
        const hasOuterDiv = /<(div|section|article)[\s>]/i.test(innerContent);
        if (hasOuterDiv) {
          // Step 1: 递归处理嵌套的子容器内部（深度优先，先内层）
          let pi = replaceTextInDiv(innerContent);
          // Step 2: 对当前层级的内容也执行包裹，防止嵌套 div 周围的兄弟裸文本被遗漏
          const processed = processContainer(pi, parentStyle);
          if (processed !== innerContent) return `<${tag}${attrs || ''}>${processed}</${tag}>`;
          return match;
        }
        const p = processContainer(innerContent, parentStyle);
        return p === innerContent ? match : `<${tag}${attrs || ''}>${p}</${tag}>`;
      });
      iterations++;
      if (htmlStr === before) break;
    } while (iterations < 10);
    return htmlStr;
  };
  result = replaceTextInDiv(result);
  return result;
}

export function removeColorCodeWatermark(html: string): string {
  const isColorWatermarkText = (plainText: string): boolean => {
    const t = plainText.trim().replace(/\s+/g, '');
    if (!t) return false;
    // 1. # + 3~8 位 hex（支持带透明度，如 #2563eb、#FFF、#2563EB80）
    if (/^#([0-9a-fA-F]{3,8})$/.test(t)) return true;
    // 2. 主色/主色调 + #xxx
    if (/^(主色调?|primary|PRIMARY|色值|颜色)[:：]?#([0-9a-fA-F]{3,8})$/.test(t)) return true;
    // 3. rgb / rgba
    if (/^rgba?\([0-9,.\s%]+\)$/i.test(t)) return true;
    // 4. 只有 HEX / COLOR / RGB / 颜色代码 这种纯关键词
    if (/^(HEX|COLOR|RGB|颜色代码|色值|十六进制)$/i.test(t)) return true;
    // 5. 「#2563b · #ffffff」这种多色代码拼接（中间没有正常的中文语义）
    if (/^(#([0-9a-fA-F]{3,8})[\s·,、|\/\\]+)+#([0-9a-fA-F]{3,8})$/i.test(t)) return true;
    return false;
  };

  const stripTags = (s: string): string => s.replace(/<[^>]+>/g, '');

  let result = html;
  for (let iter = 0; iter < 4; iter++) {
    const before = result;
    // 关键：内层必须**不包含 <div 开头**（(?!<div[\s>])[\s\S]），确保每次只剥最内层叶子 div
    result = result.replace(
      /<div(\s[^>]*)?>((?:(?!<div[\s>])[\s\S])*?)<\/div>/gi,
      (match, _attrs: string | undefined, inner: string) => {
        // 只处理文本内容比较短的 div（水印一般 2-30 字符，不会是大段落）
        const innerLen = stripTags(inner).length;
        if (innerLen > 60) return match;
        const plain = stripTags(inner);
        if (isColorWatermarkText(plain)) {
          return ''; // 删除整个 div
        }
        return match;
      },
    );
    if (result === before) break;
  }
  return result;
}


export function fixVerticalWritingLists(html: string): string {
  let result = html;

  // 第一步：全局删除所有 writing-mode 声明（除了 text-orientation，直接粗暴去掉 writing-mode）
  result = result.replace(
    /<(div|ul|ol|li|span|p|section|article|h[1-6])([^>]*style="[^"]*"[^>]*)>/gi,
    (match, _tag, _attrs) => {
      return match.replace(/style="([^"]*)"/i, (_s, style: string) => {
        let newStyle = style;
        // 去掉 writing-mode 相关
        newStyle = newStyle.replace(/writing-mode\s*:\s*[^;]+;?/gi, '');
        newStyle = newStyle.replace(/text-orientation\s*:\s*[^;]+;?/gi, '');
        newStyle = newStyle.replace(/direction\s*:\s*rtl[^;]*;?/gi, '');
        return `style="${newStyle}"`;
      });
    },
  );

  // 第二步：对 ul/ol 做结构修复（若它之前被竖排搞乱了 → 强制 flex column + gap）
  result = result.replace(/<(ul|ol)([^>]*style="[^"]*"[^>]*)>/gi, (match, _tag, _attrs) => {
    return match.replace(/style="([^"]*)"/i, (_s, style: string) => {
      const styles: Record<string, string> = {};
      for (const { key, value } of parseStyleDeclarations(style)) {
        styles[key] = value;
      }
      if (!styles['display']) styles['display'] = 'flex';
      if (styles['display'] === 'flex') {
        if (!styles['flex-direction'] || styles['flex-direction'].startsWith('row')) {
          styles['flex-direction'] = 'column';
        }
      }
      if (!styles['gap']) styles['gap'] = '16px';
      if (!styles['list-style']) styles['list-style'] = 'none';
      // 去掉过大 line-height，避免文字堆叠
      if (styles['line-height']) {
        const n = parseFloat(styles['line-height']);
        if (!Number.isNaN(n) && n > 1.8) delete styles['line-height'];
      }
      const newStyle = Object.entries(styles)
        .map(([k, v]) => `${k}:${v}`)
        .join(';');
      return `style="${newStyle}"`;
    });
  });
  return result;
}

