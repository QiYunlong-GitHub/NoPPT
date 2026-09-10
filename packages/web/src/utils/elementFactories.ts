/**
 * 纯 DOM 元素工厂函数
 * 从 EditorLayout.tsx 拆分出的「只创建 DOM 节点」的纯函数
 * - 不依赖 React state / ref / store
 * - 只做 createElement + 设置 style/attribute/className + return
 */

export function createTextElement(text: string, x: number, y: number): HTMLElement {
  const div = document.createElement('div');
  div.className = 'noppt-text-element';
  div.style.cssText = `
      position: absolute;
      left: ${x}px;
      top: ${y}px;
      min-width: 100px;
      min-height: 24px;
      padding: 4px 8px;
      font-size: 16px;
      color: #334155;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
      user-select: none;
      cursor: move;
    `;
  div.textContent = text;
  return div;
}

export function createImageElement(
  src: string,
  x: number,
  y: number,
  width?: number,
  height?: number,
): HTMLElement {
  const img = document.createElement('img');
  img.style.cssText = `
      position: absolute;
      left: ${x}px;
      top: ${y}px;
      object-fit: contain;
    `;
  img.src = src;
  if (width) img.style.width = `${width}px`;
  if (height) img.style.height = `${height}px`;
  return img;
}

export function createTableElement(
  x: number,
  y: number,
  rows: number = 3,
  cols: number = 3,
): HTMLElement {
  const table = document.createElement('table');
  table.style.cssText = `
      position: absolute;
      left: ${x}px;
      top: ${y}px;
      border-collapse: collapse;
      font-size: 14px;
      color: #334155;
      background: white;
      min-width: 300px;
    `;
  table.setAttribute('data-noppt-table', 'true');

  for (let i = 0; i < rows; i++) {
    const tr = document.createElement('tr');
    for (let j = 0; j < cols; j++) {
      const cell = document.createElement(i === 0 ? 'th' : 'td');
      cell.style.cssText = `
          border: 1px solid #cbd5e1;
          padding: 8px 12px;
          min-width: 80px;
          min-height: 32px;
          text-align: left;
          vertical-align: middle;
        `;
      if (i === 0) {
        cell.style.backgroundColor = '#f1f5f9';
        cell.style.fontWeight = '600';
      }
      cell.textContent = i === 0 ? `表头${j + 1}` : '';
      tr.appendChild(cell);
    }
    table.appendChild(tr);
  }

  return table;
}
