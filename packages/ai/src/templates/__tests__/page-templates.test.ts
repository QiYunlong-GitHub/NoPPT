import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { getPageTemplates } from '../generate-html-presentation';

type Case = [name: string, args: [number, number, string, 'sans' | 'serif' | 'mono']];

const CASES: Case[] = [
  ['default', [1280, 720, 'auto', 'sans']],
  ['emoji', [1280, 720, 'emoji', 'sans']],
  ['line-serif', [1920, 1080, 'line', 'serif']],
  ['none-mono', [1280, 720, 'none', 'mono']],
  ['filled', [1280, 720, 'filled', 'sans']],
];

const dir = path.resolve(__dirname, 'fixtures');

describe('getPageTemplates 拆分后行为等价', () => {
  for (const [name, args] of CASES) {
    it(`输出与拆分前快照一致: ${name}`, () => {
      const expected = fs.readFileSync(path.join(dir, `page-templates.${name}.txt`), 'utf-8');
      const actual = (getPageTemplates as any)(...args);
      expect(actual).toBe(expected);
    });
  }
});
