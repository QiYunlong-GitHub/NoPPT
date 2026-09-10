import type { Page } from 'playwright-core';
import type { ImageDataLike } from '../png-decoder';
import { contrastRatio, normalizeContrastScore, relativeLuminance } from './color-utils';

export interface GridContrastResult {
  mean: number;
  min: number;
  max: number;
  pairs: number;
}

export interface LowContrastPair {
  text: string;
  ratio: number;
  foreground: string;
  background: string;
}

export interface TextContrastResult {
  mean: number;
  min: number;
  max: number;
  lowContrastPairs: LowContrastPair[];
}

export interface FigureGroundContrastResult {
  mean: number;
  min: number;
  max: number;
  grid: GridContrastResult;
  text: TextContrastResult;
}

function cellAverageLuminance(
  data: Uint8ClampedArray,
  width: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  let sum = 0;
  let count = 0;
  for (let y = y1; y < y2; y++) {
    for (let x = x1; x < x2; x++) {
      const idx = (y * width + x) * 4;
      sum += relativeLuminance(data[idx], data[idx + 1], data[idx + 2]);
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

export function computeGridContrast(imageData: ImageDataLike, gridSize = 4): GridContrastResult {
  const { data, width, height } = imageData;
  const cellW = Math.floor(width / gridSize);
  const cellH = Math.floor(height / gridSize);

  const luminances: number[] = [];
  for (let i = 0; i < gridSize; i++) {
    for (let j = 0; j < gridSize; j++) {
      const x1 = j * cellW;
      const y1 = i * cellH;
      const x2 = j === gridSize - 1 ? width : (j + 1) * cellW;
      const y2 = i === gridSize - 1 ? height : (i + 1) * cellH;
      luminances.push(cellAverageLuminance(data, width, x1, y1, x2, y2));
    }
  }

  const scores: number[] = [];
  for (let i = 0; i < gridSize; i++) {
    for (let j = 0; j < gridSize; j++) {
      const idx = i * gridSize + j;
      if (j < gridSize - 1) {
        const ratio = contrastRatio(luminances[idx], luminances[idx + 1]);
        scores.push(normalizeContrastScore(ratio));
      }
      if (i < gridSize - 1) {
        const ratio = contrastRatio(luminances[idx], luminances[idx + gridSize]);
        scores.push(normalizeContrastScore(ratio));
      }
    }
  }

  if (scores.length === 0) {
    return { mean: 0, min: 0, max: 0, pairs: 0 };
  }

  let sum = 0;
  let min = scores[0];
  let max = scores[0];
  for (const s of scores) {
    sum += s;
    if (s < min) min = s;
    if (s > max) max = s;
  }
  return { mean: sum / scores.length, min, max, pairs: scores.length };
}

function parseColorToRgb(color: string): { r: number; g: number; b: number } | null {
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(',').map((p) => parseFloat(p.trim()));
  if (parts.length < 3) return null;
  return { r: parts[0], g: parts[1], b: parts[2] };
}

export async function computeTextContrast(page: Page): Promise<TextContrastResult> {
  const rawPairs = await page.evaluate(() => {
    const elements = document.body.querySelectorAll<HTMLElement>('*');
    const results: Array<{ text: string; fg: string; bg: string; visible: boolean }> = [];
    const seen = new Set<string>();

    for (const el of elements) {
      const text = (el.textContent || '').trim();
      if (!text || text.length > 200) continue;

      const style = window.getComputedStyle(el);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        parseFloat(style.opacity) === 0
      ) {
        continue;
      }

      const childText = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => (n.textContent || '').trim())
        .join('')
        .trim();
      if (!childText) continue;

      let bgEl: HTMLElement | null = el;
      let bgColor = 'rgba(0,0,0,0)';
      while (bgEl) {
        const bs = window.getComputedStyle(bgEl).backgroundColor;
        const m = bs.match(/rgba?\(([^)]+)\)/);
        if (m) {
          const parts = m[1].split(',').map((p) => parseFloat(p.trim()));
          const alpha = parts.length === 4 ? parts[3] : 1;
          if (alpha > 0.01) {
            bgColor = bs;
            break;
          }
        }
        bgEl = bgEl.parentElement;
      }

      const key = `${text}|${style.color}|${bgColor}`;
      if (seen.has(key)) continue;
      seen.add(key);

      results.push({ text: childText.slice(0, 80), fg: style.color, bg: bgColor, visible: true });
    }
    return results;
  });

  const ratios: number[] = [];
  const lowContrastPairs: LowContrastPair[] = [];

  for (const pair of rawPairs) {
    const fg = parseColorToRgb(pair.fg);
    const bg = parseColorToRgb(pair.bg);
    if (!fg || !bg) continue;

    const lumFg = relativeLuminance(fg.r, fg.g, fg.b);
    const lumBg = relativeLuminance(bg.r, bg.g, bg.b);
    const ratio = contrastRatio(lumFg, lumBg);
    ratios.push(ratio);

    if (ratio < 4.5) {
      lowContrastPairs.push({
        text: pair.text,
        ratio,
        foreground: pair.fg,
        background: pair.bg,
      });
    }
  }

  if (ratios.length === 0) {
    return { mean: 1, min: 1, max: 1, lowContrastPairs: [] };
  }

  let sum = 0;
  let min = ratios[0];
  let max = ratios[0];
  for (const r of ratios) {
    sum += r;
    if (r < min) min = r;
    if (r > max) max = r;
  }

  lowContrastPairs.sort((a, b) => a.ratio - b.ratio);

  return {
    mean: sum / ratios.length,
    min,
    max,
    lowContrastPairs,
  };
}

export async function computeFigureGroundContrast(
  imageData: ImageDataLike,
  page: Page,
): Promise<FigureGroundContrastResult> {
  const grid = computeGridContrast(imageData);
  const text = await computeTextContrast(page);

  const gridScore = grid.mean;
  const textScore = normalizeContrastScore(text.mean);

  const combinedMean = gridScore * 0.4 + textScore * 0.6;

  return {
    mean: combinedMean,
    min: Math.min(grid.min, normalizeContrastScore(text.min)),
    max: Math.max(grid.max, normalizeContrastScore(text.max)),
    grid,
    text,
  };
}
