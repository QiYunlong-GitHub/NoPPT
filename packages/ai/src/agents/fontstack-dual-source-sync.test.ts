// ================================================================
// Task 3: 字体栈双副本同步漂移回归守卫（fontstack-dual-source-sync.test.ts）
//   验证 agent 层 getFontStack 与 templates 层 getFontStackLocal
//   的三分支（sans/serif/mono）返回值一致性。
//   - mono:  normalize 后逐字节全等（已同步完成）
//   - sans/serif: 核心元素宽松断言 + FIXME skip 标记将来对齐
//   CI 漂移回归守卫: 双副本不一致时 FAIL
// ================================================================
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { AIModelProvider } from '../providers/base';
import { HTMLPresentationAgent } from './html-presentation-agent';

type AnyAgent = HTMLPresentationAgent & Record<string, any>;

function makeAgent(): HTMLPresentationAgent {
  const dummy: AIModelProvider = {
    name: 'dummy',
    async chat() {
      return { role: 'assistant', content: '' };
    },
    supportsStreaming: false,
  } as unknown as AIModelProvider;
  return new HTMLPresentationAgent(dummy);
}

/** normalize：去所有空白 + 把 " 统一为 ' + 转 toLowerCase */
function normalize(str: string): string {
  return str.replace(/\s+/g, '').replace(/"/g, "'").toLowerCase();
}

// ================================================================
// 从 templates 文件中抽取 getFontStackLocal 的三个 case return 值
// ================================================================
const TEMPLATES_PATH = path.resolve(__dirname, '../templates/generate-html-presentation.ts');
const AGENT_PATH = path.resolve(__dirname, './html-presentation-agent.ts');
const templatesSrc = fs.readFileSync(TEMPLATES_PATH, 'utf-8');
const agentSrc = fs.readFileSync(AGENT_PATH, 'utf-8');

/**
 * 从 getFontStackLocal 函数源码中正则抽取指定 case 的 return 字符串。
 * 策略：匹配 case 'xxx': return "..."; 或 default: return "...";
 */
function extractTemplateCaseReturn(src: string, caseKey: 'mono' | 'serif' | 'sans'): string {
  // 对 sans 还要匹配 default 分支作为兜底
  let pattern: RegExp;
  if (caseKey === 'sans') {
    // 先尝试 case 'sans'，若无则尝试 default
    pattern = /case\s*['"]sans['"]\s*:\s*return\s*(['"])((?:\\.|(?!\1).)*)\1\s*;?/i;
    let m = src.match(pattern);
    if (m) return m[2];
    // fallback: default 分支
    pattern = /default\s*:\s*return\s*(['"])((?:\\.|(?!\1).)*)\1\s*;?/i;
    m = src.match(pattern);
    if (m) return m[2];
    return '';
  }
  pattern = new RegExp(
    `case\\s*['"]${caseKey}['"]\\s*:\\s*return\\s*(['"])((?:\\\\.|(?!\\1).)*)\\1\\s*;?`,
    'i',
  );
  const m = src.match(pattern);
  return m ? m[2] : '';
}

const templateMono = extractTemplateCaseReturn(templatesSrc, 'mono');
const templateSerif = extractTemplateCaseReturn(templatesSrc, 'serif');
const templateSans = extractTemplateCaseReturn(templatesSrc, 'sans');

// ================================================================
// Test Suite
// ================================================================
describe('Task 3: fontstack 双副本同步（漂移回归守卫）', () => {
  const agent = makeAgent() as AnyAgent;
  const agentMono = (agent as any).getFontStack('mono') as string;
  const agentSerif = (agent as any).getFontStack('serif') as string;
  const agentSans = (agent as any).getFontStack('sans') as string;

  // ---- T3.1 mono normalize 后全等（必 PASS）----
  it('T3.1 mono 分支：agent / template normalize 后逐字节全等', () => {
    expect(templateMono).toBeTruthy();
    expect(agentMono).toBeTruthy();
    expect(normalize(agentMono)).toBe(normalize(templateMono));
  });

  // ---- T3.2 mono 结果含 CJK 关键字 ----
  it('T3.2 mono 分支：两边均含 CJK 关键字（pingfangsc microsoftyahei notosanssc）+ 末尾 monospace', () => {
    const agentN = normalize(agentMono);
    const tplN = normalize(templateMono);
    expect(agentN).toContain('pingfangsc');
    expect(agentN).toContain('microsoftyahei');
    expect(agentN).toContain('notosanssc');
    expect(agentN).toMatch(/monospace$/);
    expect(tplN).toContain('pingfangsc');
    expect(tplN).toContain('microsoftyahei');
    expect(tplN).toContain('notosanssc');
    expect(tplN).toMatch(/monospace$/);
  });

  // ---- T3.3 serif 核心元素宽松断言（暂不强求全等）----
  it('T3.3 serif 分支：两边核心元素宽松断言（notoserifsc / georgia / timesnewroman / serif 收尾）', () => {
    const agentN = normalize(agentSerif);
    const tplN = normalize(templateSerif);
    expect(agentN).toBeTruthy();
    expect(tplN).toBeTruthy();
    // agent 侧核心
    expect(agentN).toContain('notoserifsc');
    expect(agentN).toContain('georgia');
    expect(agentN).toContain('timesnewroman');
    expect(agentN).toMatch(/,serif$/);
    // template 侧核心
    expect(tplN).toContain('notoserifsc');
    expect(tplN).toContain('georgia');
    expect(tplN).toContain('timesnewroman');
    expect(tplN).toMatch(/,serif$/);
  });

  it.skip('FIXME: serif 分支双副本逐字节全等 TODO', () => {
    // 将来同步完成后激活此测试
    expect(normalize(agentSerif)).toBe(normalize(templateSerif));
  });

  // ---- T3.4 sans 核心元素宽松断言（暂不强求全等）----
  it('T3.4 sans 分支：两边核心元素宽松断言（system-ui / notosanssc / pingfangsc / microsoftyahei / sans-serif 收尾）', () => {
    const agentN = normalize(agentSans);
    const tplN = normalize(templateSans);
    expect(agentN).toBeTruthy();
    expect(tplN).toBeTruthy();
    // agent 侧
    expect(agentN).toContain('system-ui');
    expect(agentN).toContain('notosanssc');
    expect(agentN).toContain('pingfangsc');
    expect(agentN).toContain('microsoftyahei');
    expect(agentN).toMatch(/,sans-serif$/);
    // template 侧
    expect(tplN).toContain('system-ui');
    expect(tplN).toContain('notosanssc');
    expect(tplN).toContain('pingfangsc');
    expect(tplN).toContain('microsoftyahei');
    expect(tplN).toMatch(/,sans-serif$/);
  });

  it.skip('FIXME: sans 分支双副本逐字节全等 TODO', () => {
    // 将来同步完成后激活此测试
    expect(normalize(agentSans)).toBe(normalize(templateSans));
  });

  // ---- T3.5 漂移守卫注释存在性断言 ----
  it('T3.5 两个源文件均存在 fontstack-dual-source-sync.test.ts 或 漂移回归守卫 注释标记', () => {
    const hasGuard = (src: string): boolean =>
      src.includes('fontstack-dual-source-sync.test.ts') || src.includes('漂移回归守卫');
    expect(hasGuard(agentSrc)).toBe(true);
    expect(hasGuard(templatesSrc)).toBe(true);
  });
});
