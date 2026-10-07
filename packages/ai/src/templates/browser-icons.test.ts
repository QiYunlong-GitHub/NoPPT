import { describe, expect, it } from 'vitest';
import { renderSvgIcon, resolveIconByIndex } from './browser-icons';

describe('browser icon subset', () => {
  it('keeps the fallback order stable', () => {
    expect(resolveIconByIndex(0)).toBe('target');
    expect(resolveIconByIndex(34)).toBe('flag');
    expect(resolveIconByIndex(35)).toBe('target');
    expect(resolveIconByIndex(-1)).toBe('flag');
  });

  it('renders line and filled SVG without loading the full registry', () => {
    expect(renderSvgIcon('target', 'line', 20, '#2563eb')).toContain('stroke="#2563eb"');
    expect(renderSvgIcon('target', 'filled', 20, '#2563eb')).toContain('fill="#2563eb"');
    expect(renderSvgIcon('unknown')).toBe('');
  });
});
