/**
 * 选中 / 候选判定 / DOM 路径 / 追加目标 / 文字节点包裹 纯工具函数集
 * 从 EditorLayout.tsx A 职责域拆分出来
 *
 * 所有 DOM 操作需要显式传入 innerDiv (data-slide-content="true" 的那个 div)，
 * 避免依赖 React ref，保持纯函数可测试。
 */

/**
 * 生成一个稳定、唯一的元素 ID。
 * 格式：'n' + Date.now().toString(36) + 4 位随机字符。
 * 计数器仅用于避免同一毫秒内的碰撞。
 */
let __elementIdCounter = 0;
export function generateElementId(): string {
  __elementIdCounter = (__elementIdCounter + 1) % 0xffff;
  const rand = Math.random().toString(36).substring(2, 6);
  return `n${Date.now().toString(36)}${__elementIdCounter.toString(36)}${rand}`;
}

/**
 * 判断一个元素是否需要被分配 data-noppt-id。
 * 规则：
 *  - 不是 innerDiv 本身
 *  - 不是 slide root wrapper（全屏包装容器）
 *  - 通过 isTextContent / isVisualContainer / isLayoutContainer 任一判定
 *  - 或带有 noppt-text-element / noppt-slide-image-element / noppt-group-element / noppt-table-element class
 *  - 或标签为 IMG / VIDEO / TABLE
 */
function isIdTargetElement(el: HTMLElement, innerDiv: HTMLElement): boolean {
  if (el === innerDiv) return false;
  if (isSlideRootWrapper(el, innerDiv)) return false;

  const tag = el.tagName;
  if (tag === 'IMG' || tag === 'VIDEO' || tag === 'TABLE') return true;

  if (
    el.classList.contains('noppt-text-element') ||
    el.classList.contains('noppt-slide-image-element') ||
    el.classList.contains('noppt-group-element') ||
    el.classList.contains('noppt-table-element')
  ) {
    return true;
  }

  if (isTextContent(el)) return true;
  if (isVisualContainer(el, innerDiv)) return true;
  if (isLayoutContainer(el)) return true;

  return false;
}

/**
 * 遍历 innerDiv 的所有后代元素，为「可选中」但尚未有 data-noppt-id 的元素分配 ID。
 * 不会给 innerDiv 本身或 slide root wrapper 分配 ID。
 */
export function ensureElementIds(innerDiv: HTMLElement | null | undefined): void {
  if (!innerDiv) return;
  const descendants = innerDiv.querySelectorAll<HTMLElement>('*');
  for (let i = 0; i < descendants.length; i++) {
    const el = descendants[i];
    if (el.hasAttribute('data-noppt-id')) continue;
    if (isIdTargetElement(el, innerDiv)) {
      el.setAttribute('data-noppt-id', generateElementId());
    }
  }
}

/**
 * 通过 data-noppt-id 直接查找元素。
 */
export function getElementById(
  id: string,
  innerDiv: HTMLElement | null | undefined,
): HTMLElement | null {
  if (!innerDiv || !id) return null;
  try {
    return innerDiv.querySelector<HTMLElement>(`[data-noppt-id="${id}"]`);
  } catch {
    return null;
  }
}

const NOPPT_ID_PREFIX = '[data-noppt-id=';

/**
 * 构建元素在 slide 内容内的唯一路径（CSS selector 形式）
 *
 * 关键修复：
 *  路径中使用 :nth-child(N)，CSS 里的 nth-child 是基于「所有兄弟节点
 *  （含 Text/Comment）」的 1-based 计数。因此这里必须用
 *  parent.childNodes（而不是 parent.children）来算 index，否则
 *  当兄弟节点之间存在空白 Text 节点时，保存的路径在恢复时会
 *  匹配到错误的元素 / 匹配不到，导致「瞬间选中又取消」的诡异现象。
 *
 * 新机制：如果元素带有 data-noppt-id，优先返回 `[data-noppt-id="xxx"]`
 * 这一唯一选择器，不再依赖父链，DOM 结构变化也能稳定恢复。
 * 没有 ID 的元素仍回退到 nth-child 路径，保证向后兼容。
 */
export function getElementPath(
  element: HTMLElement,
  innerDiv: HTMLElement | null | undefined,
): string {
  if (!innerDiv) return '';
  if (element === innerDiv) return '';

  const stableId = element.getAttribute && element.getAttribute('data-noppt-id');
  if (stableId) {
    return `[data-noppt-id="${stableId}"]`;
  }

  const path: string[] = [];
  let current: HTMLElement | null = element;

  while (current && current !== innerDiv) {
    const parent: HTMLElement | null = current.parentElement;
    if (!parent) break;

    // 用 childNodes（含 Text/Comment）计算 index，保证与 CSS :nth-child 语义一致
    const allSiblings = Array.from(parent.childNodes);
    const index = allSiblings.indexOf(current);
    path.unshift(`${current.tagName.toLowerCase()}:nth-child(${index + 1})`);
    current = parent;
  }

  return path.join(' > ');
}

/**
 * 清理 innerDiv 中只包含空白的 Text 节点。
 *
 * 空白 Text 节点（换行/缩进）会导致以下问题：
 *  - 保存路径时基于 childNodes 计算出来的 nth-child 索引，
 *    在重新渲染（dangerouslySetInnerHTML）后由于浏览器解析
 *    HTML 时空白节点分布不一致，从而匹配失败。
 *  - 多次粘贴 / 保存后兄弟节点数量不稳定。
 *
 * 在 saveSlideHtml / paste / normalize 等可能重构 DOM 的
 * 操作前后统一调用一次，保证 DOM 结构稳定、可预测。
 */
export function normalizeWhitespaceTextNodes(innerDiv: HTMLElement | null | undefined): void {
  if (!innerDiv) return;
  const walker = document.createTreeWalker(innerDiv, NodeFilter.SHOW_TEXT, null);
  const toRemove: Node[] = [];
  let node = walker.nextNode();
  while (node) {
    if (!node.nodeValue || !node.nodeValue.trim()) {
      // 只清理全空白的 Text 节点；保留非空 Text 节点（真实文字内容）
      toRemove.push(node);
    }
    node = walker.nextNode();
  }
  toRemove.forEach((n) => n.parentNode?.removeChild(n));
}

/**
 * 根据路径恢复 DOM 元素
 *
 * - 若路径以 `[data-noppt-id=` 开头，说明是稳定 ID 选择器，直接 querySelector。
 * - 否则按原有 nth-child 路径处理。
 */
export function getElementByPath(
  path: string,
  innerDiv: HTMLElement | null | undefined,
): HTMLElement | null {
  if (!innerDiv || !path) return null;

  try {
    if (path.startsWith(NOPPT_ID_PREFIX)) {
      return innerDiv.querySelector(path) as HTMLElement | null;
    }
    return innerDiv.querySelector(path) as HTMLElement | null;
  } catch {
    return null;
  }
}

export function isLayoutContainer(element: HTMLElement): boolean {
  if (
    element.tagName !== 'DIV' &&
    element.tagName !== 'SECTION' &&
    element.tagName !== 'ARTICLE' &&
    element.tagName !== 'UL' &&
    element.tagName !== 'OL'
  )
    return false;
  const style = window.getComputedStyle(element);
  return (
    style.display === 'flex' ||
    style.display === 'inline-flex' ||
    style.display === 'grid' ||
    style.display === 'inline-grid'
  );
}

/**
 * 判断 element 是否是「视觉容器」（可被选中的盒子，而非文字裸节点）。
 * @param element 要判定的元素
 * @param innerDiv data-slide-content 容器，用于做「全屏包装容器」过滤
 * @param excludeElement 可选，排除自己（防止自包含判定）
 */
export function isVisualContainer(
  element: HTMLElement,
  innerDiv: HTMLElement | null | undefined,
  excludeElement?: HTMLElement,
): boolean {
  if (element.tagName !== 'DIV' && element.tagName !== 'SECTION' && element.tagName !== 'ARTICLE')
    return false;
  if (element === excludeElement) return false;
  if (innerDiv && element === innerDiv) return false;

  if (isLayoutContainer(element)) {
    if (innerDiv) {
      const innerRect = innerDiv.getBoundingClientRect();
      const elRect = element.getBoundingClientRect();
      const widthRatio = elRect.width / innerRect.width;
      const heightRatio = elRect.height / innerRect.height;
      if (widthRatio > 0.95 && heightRatio > 0.95) return false;
    }
    return true;
  }

  const style = window.getComputedStyle(element);
  const bgColor = style.backgroundColor;
  const hasBg = !!bgColor && bgColor !== 'transparent' && bgColor !== 'rgba(0, 0, 0, 0)';
  const borderWidth = style.borderWidth;
  const hasBorder = !!borderWidth && parseFloat(borderWidth) > 0;
  const borderRadius = style.borderRadius;
  const hasRadius = !!borderRadius && borderRadius !== '0px';
  const boxShadow = style.boxShadow;
  const hasShadow = !!boxShadow && boxShadow !== 'none';
  return hasBg || hasBorder || hasRadius || hasShadow;
}

export function isTextContent(element: HTMLElement): boolean {
  if (
    [
      'H1',
      'H2',
      'H3',
      'H4',
      'H5',
      'H6',
      'P',
      'LI',
      'BUTTON',
      'INPUT',
      'LABEL',
      'TABLE',
      'UL',
      'OL',
      'TR',
      'TD',
      'TH',
      'THEAD',
      'TBODY',
      'FIGCAPTION',
    ].includes(element.tagName)
  ) {
    return true;
  }
  if (element.tagName === 'IMG' || element.tagName === 'VIDEO' || element.tagName === 'FIGURE')
    return true;
  if (['SPAN', 'STRONG', 'EM', 'B', 'I', 'U', 'A', 'SUP', 'SUB'].includes(element.tagName)) {
    return true;
  }
  if (isLayoutContainer(element)) return false;
  if (element.tagName !== 'DIV' && element.tagName !== 'SECTION' && element.tagName !== 'ARTICLE')
    return false;
  if (
    isVisualContainer(element, element.closest('[data-slide-content="true"]') as HTMLElement | null)
  )
    return false;

  const text = element.innerText?.trim() || '';
  if (!text || text.length === 0) return false;

  return true;
}

export function isTextElement(element: HTMLElement): boolean {
  const tagName = element.tagName.toLowerCase();
  if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'strong', 'em', 'li'].includes(tagName)) {
    return true;
  }
  if (element.classList.contains('noppt-text-element')) {
    return true;
  }
  if (tagName === 'div' || tagName === 'section' || tagName === 'article') {
    const childCount = element.children.length;
    if (childCount === 0) {
      return !!element.textContent?.trim();
    }
    const textChildren = Array.from(element.children).filter((child) => {
      const childTag = child.tagName.toLowerCase();
      return (
        ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'strong', 'em', 'br'].includes(
          childTag,
        ) || (child as HTMLElement).classList?.contains('noppt-text-element')
      );
    });
    return textChildren.length === childCount;
  }
  return false;
}

/**
 * 判定一个元素是否是「最外层充满整个幻灯片的全屏包装容器」。
 * 如果命中，该元素不允许被选中。
 */
export function isSlideRootWrapper(
  element: HTMLElement,
  innerDiv: HTMLElement | null | undefined,
): boolean {
  if (!element || !innerDiv) return false;
  if (!innerDiv.contains(element)) return false;
  if (element === innerDiv) return false;
  if (element.tagName !== 'DIV' && element.tagName !== 'SECTION' && element.tagName !== 'ARTICLE')
    return false;
  if (
    element.classList.contains('noppt-text-element') ||
    element.classList.contains('noppt-slide-image-element') ||
    element.classList.contains('noppt-group-element')
  )
    return false;
  const style = window.getComputedStyle(element);
  if (style.position === 'absolute' || style.position === 'fixed') return false;

  // 判定 1：元素就是 innerDiv 的直接第一层子元素（典型的 AI 生成 HTML 根容器）
  // 且 width/height 样式写了 100%，同时是 flex/grid 布局或 overflow:hidden + position:relative + box-sizing:border-box 的典型结构
  const isDirectChild = element.parentElement === innerDiv;
  const rs = element.style;
  const hasFullSizeStyle =
    (rs.width === '100%' || style.width === '100%') &&
    (rs.height === '100%' || style.height === '100%');
  const hasTypicalRootStructure =
    (style.overflow === 'hidden' || rs.overflow === 'hidden') &&
    (style.position === 'relative' || rs.position === 'relative') &&
    (style.boxSizing === 'border-box' || rs.boxSizing === 'border-box');

  if (
    isDirectChild &&
    hasFullSizeStyle &&
    (hasTypicalRootStructure || style.display.includes('flex') || style.display.includes('grid'))
  ) {
    return true;
  }

  // 判定 2：用 offsetWidth/offsetHeight（含 padding/border，即 CSS 盒子的总尺寸）来判断，
  // 避免 padding 导致 getBoundingClientRect 比例不足的问题
  const innerOffsetW = innerDiv.offsetWidth || 1;
  const innerOffsetH = innerDiv.offsetHeight || 1;
  const elOffsetW = element.offsetWidth;
  const elOffsetH = element.offsetHeight;
  const offsetWRatio = elOffsetW / innerOffsetW;
  const offsetHRatio = elOffsetH / innerOffsetH;
  if (offsetWRatio > 0.95 && offsetHRatio > 0.95) {
    return true;
  }

  // 判定 3：兜底保留 getBoundingClientRect 比例判定（原来的逻辑）
  const innerRect = innerDiv.getBoundingClientRect();
  const elRect = element.getBoundingClientRect();
  const widthRatio = elRect.width / innerRect.width;
  const heightRatio = elRect.height / innerRect.height;
  return widthRatio > 0.95 && heightRatio > 0.95;
}

/**
 * 在「视觉容器」内，把纯文字（无 block 子元素 + 有文字内容 + 是容器）包裹成 noppt-text-wrapper，
 * 防止文字节点裸奔导致文字编辑 caret 定位异常。
 *
 * @param innerDiv data-slide-content="true" 容器
 */
export function wrapTextInVisualContainers(innerDiv: HTMLElement | null | undefined): void {
  if (!innerDiv) return;

  const wrapTextNodes = (parent: HTMLElement) => {
    const children = Array.from(parent.childNodes);
    let hasText = false;
    let hasBlockElement = false;

    for (const child of children) {
      if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
        hasText = true;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const childEl = child as HTMLElement;
        if (
          [
            'DIV',
            'SECTION',
            'ARTICLE',
            'P',
            'H1',
            'H2',
            'H3',
            'H4',
            'H5',
            'H6',
            'UL',
            'OL',
            'LI',
            'IMG',
            'TABLE',
          ].includes(childEl.tagName)
        ) {
          hasBlockElement = true;
        }
      }
    }

    if (hasText && !hasBlockElement && isVisualContainer(parent, innerDiv)) {
      const wrapper = document.createElement('span');
      wrapper.className = 'noppt-text-wrapper';
      wrapper.style.display = 'block';
      wrapper.style.width = '100%';
      wrapper.style.height = '100%';

      while (parent.firstChild) {
        wrapper.appendChild(parent.firstChild);
      }
      parent.appendChild(wrapper);
    } else {
      for (const child of children) {
        if (child.nodeType === Node.ELEMENT_NODE) {
          const childEl = child as HTMLElement;
          if (childEl.classList.contains('noppt-text-wrapper')) continue;
          wrapTextNodes(childEl);
        }
      }
    }
  };

  const divs = innerDiv.querySelectorAll('div, section, article');
  divs.forEach((el) => {
    if (isVisualContainer(el as HTMLElement, innerDiv)) {
      wrapTextNodes(el as HTMLElement);
    }
  });
}

/**
 * 从 DOM 事件 target 向上遍历，找到第一个「可选中」的元素。
 * 候选元素优先选择最内层（inner）。
 *
 * @param target 触发事件的元素
 * @param innerDiv data-slide-content="true" 容器（边界）
 * @param mode 选择策略：inner=最内, outer=最外, parent=第二层, deep=尽量向下走
 */
export function findSelectableElement(
  target: HTMLElement,
  innerDiv: HTMLElement | null,
  mode: 'inner' | 'outer' | 'deep' | 'parent' = 'inner',
): HTMLElement | null {
  if (!innerDiv) return null;

  const candidates: HTMLElement[] = [];
  let element = target;

  while (element && element !== innerDiv && element.parentElement !== innerDiv.parentElement) {
    if (isSlideRootWrapper(element, innerDiv)) {
      element = element.parentElement as HTMLElement;
      continue;
    }
    if (element.classList.contains('noppt-slide-image-element')) {
      candidates.push(element);
      break;
    }
    if (element.classList.contains('noppt-group-element')) {
      candidates.push(element);
      break;
    }
    if (
      isTextContent(element) ||
      isVisualContainer(element, innerDiv) ||
      isLayoutContainer(element)
    ) {
      if (!isSlideRootWrapper(element, innerDiv)) {
        candidates.push(element);
      }
    }
    if (element.parentElement === innerDiv) {
      break;
    }
    element = element.parentElement as HTMLElement;
  }

  if (candidates.length === 0) return null;

  const filtered = candidates.filter((c) => !isSlideRootWrapper(c, innerDiv));
  if (filtered.length === 0) return null;

  switch (mode) {
    case 'inner':
      return filtered[0];
    case 'outer':
      return filtered[filtered.length - 1];
    case 'parent':
      return filtered[1] || filtered[filtered.length - 1];
    case 'deep': {
      const first = filtered[0];
      const firstChild = first.querySelector(':scope > *') as HTMLElement | null;
      if (firstChild) {
        const deepTarget = findSelectableElement(firstChild, innerDiv, 'inner');
        return deepTarget || first;
      }
      return first;
    }
    default:
      return filtered[0];
  }
}

/**
 * 取得应该把新元素 appendChild 到哪个 DOM 容器：
 * - 如果 innerDiv 的第一层直接子元素是「全屏根容器」（width:100%/height:100% 且 position:relative），
 *   就把它作为追加目标。这是因为它就是 absolute 子元素的 containing block（坐标基准），
 *   不管它有没有 padding、是不是 flex 布局。
 *   （即便 firstRoot 有 padding，absolute 子元素的 top/left 也是相对于它的 padding-box，
 *    选中时用 getBoundingClientRect 计算 left/top 也是基于 same containing block 反算的，
 *    所以选它作为 appendTarget 才能保证前后坐标一致不发生保存后「跳动」。）
 * - 否则直接追加到 innerDiv。
 */
export function getSlideAppendTarget(innerDiv: HTMLElement): HTMLElement {
  const existingRoot = innerDiv.firstElementChild as HTMLElement | null;
  if (existingRoot && existingRoot !== innerDiv) {
    const cs = window.getComputedStyle(existingRoot);
    const rs = existingRoot.style;
    const hasFullSize =
      (rs.width === '100%' || cs.width === '100%') &&
      (rs.height === '100%' || cs.height === '100%');
    const isRelative = cs.position === 'relative' || rs.position === 'relative';
    if (hasFullSize && isRelative) {
      return existingRoot;
    }
  }
  return innerDiv;
}
