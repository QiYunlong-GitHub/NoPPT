import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpController } from './mcp.controller';
import { readDraft } from './draft-store';
import type { McpContext } from './mcp-context';

type PrepareDraftBoundary = {
  prepareOutlineDraft(
    rawArgs: Record<string, unknown>,
    ctx: McpContext,
  ): Promise<Record<string, unknown>>;
  toolDefinitions(): Array<{
    name: string;
    inputSchema: {
      required?: string[];
      additionalProperties?: boolean;
      properties?: Record<string, { enum?: string[] }>;
    };
  }>;
};

type HermesCall = {
  name: string;
  args: Record<string, unknown>;
};

/**
 * Constrained Hermes contract harness.
 *
 * It deliberately invokes the real controller draft boundary in a temporary
 * cwd, but never connects to MCP/HTTP and never calls the generation tool.
 */
describe('Hermes noppt_prepare_outline_draft contract', () => {
  let originalCwd: string;
  let tempCwd: string;
  let originalWebUrl: string | undefined;
  let originalPerSlide: string | undefined;
  let originalMaxChars: string | undefined;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempCwd = mkdtempSync(join(tmpdir(), 'noppt-hermes-contract-'));
    process.chdir(tempCwd);
    originalWebUrl = process.env.NOPPT_WEB_URL;
    originalPerSlide = process.env.NOPPT_DRAFT_CHARS_PER_SLIDE;
    originalMaxChars = process.env.NOPPT_MAX_REF_TEXT_CHARS;
    process.env.NOPPT_WEB_URL = 'http://localhost:5173';
    process.env.NOPPT_DRAFT_CHARS_PER_SLIDE = '800';
    process.env.NOPPT_MAX_REF_TEXT_CHARS = '20000';
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempCwd, { recursive: true, force: true });
    if (originalWebUrl === undefined) delete process.env.NOPPT_WEB_URL;
    else process.env.NOPPT_WEB_URL = originalWebUrl;
    if (originalPerSlide === undefined) delete process.env.NOPPT_DRAFT_CHARS_PER_SLIDE;
    else process.env.NOPPT_DRAFT_CHARS_PER_SLIDE = originalPerSlide;
    if (originalMaxChars === undefined) delete process.env.NOPPT_MAX_REF_TEXT_CHARS;
    else process.env.NOPPT_MAX_REF_TEXT_CHARS = originalMaxChars;
  });

  function createBoundary() {
    const controller = new McpController({} as never, {} as never, {} as never);
    return controller as unknown as PrepareDraftBoundary;
  }

  function createContext(audit = vi.fn(async () => undefined)): McpContext {
    return {
      keyId: 'contract-test-key-id',
      tenantId: 'hermes',
      userKey: 'local',
      audit,
    } as unknown as McpContext;
  }

  it('exposes an auto-only exact tool schema and rejects guided/unknown input', async () => {
    const boundary = createBoundary();
    const definition = boundary
      .toolDefinitions()
      .find((tool) => tool.name === 'noppt_prepare_outline_draft');

    expect(definition?.inputSchema.required?.slice().sort()).toEqual(['slideCount', 'topic']);
    expect(definition?.inputSchema.additionalProperties).toBe(false);
    expect(definition?.inputSchema.properties?.mode?.enum).toEqual(['auto']);

    await expect(
      boundary.prepareOutlineDraft(
        { topic: '主题', slideCount: 4, mode: 'guided' },
        createContext(),
      ),
    ).rejects.toThrow();
    await expect(
      boundary.prepareOutlineDraft(
        { topic: '主题', slideCount: 4, unexpected: true },
        createContext(),
      ),
    ).rejects.toThrow();
  });

  it('calls only prepare, returns openUrl, truncates from the head, and waits for config confirmation', async () => {
    const boundary = createBoundary();
    const calls: HermesCall[] = [];
    const nopptGenerate = vi.fn();
    const promote = vi.fn();
    const source = `IMPORTANT-FIRST\n${'x'.repeat(5000)}\nTAIL-MUST-NOT-REACH`;
    const hermesMock = {
      async call(name: string, args: Record<string, unknown>) {
        calls.push({ name, args });
        if (name === 'noppt_generate') return nopptGenerate(args);
        if (name === 'promote') return promote(args);
        if (name !== 'noppt_prepare_outline_draft') throw new Error(`unexpected tool: ${name}`);
        return boundary.prepareOutlineDraft(args, createContext());
      },
    };

    const response = await hermesMock.call('noppt_prepare_outline_draft', {
      topic: '厄尔尼诺：现象、影响与应对',
      slideCount: 4,
      referenceText: source,
      // Omitted intentionally: the schema default must make this auto.
    });

    expect(calls.map(({ name }) => name)).toEqual(['noppt_prepare_outline_draft']);
    expect(nopptGenerate).not.toHaveBeenCalled();
    expect(promote).not.toHaveBeenCalled();
    expect(Object.keys(response).sort()).toEqual(['openUrl']);

    const openUrl = new URL(String(response.openUrl));
    expect(openUrl.origin).toBe('http://localhost:5173');
    expect(openUrl.searchParams.get('ai')).toBe('1');
    expect(openUrl.searchParams.get('draft')).toMatch(/^drf_[a-f0-9]{32}$/);
    expect(openUrl.searchParams.get('t')).toBe('hermes');
    expect(openUrl.searchParams.get('u')).toBe('local');
    expect(openUrl.searchParams.get('token')).toMatch(/^[a-f0-9]{64}$/);

    // The deep link is the config handoff; no confirm action is simulated here.
    // A generated presentation or promotion must not exist as a side effect.
    expect(existsSync(join(tempCwd, 'data', 'drafts'))).toBe(true);
    expect(existsSync(join(tempCwd, 'data', 'presentations'))).toBe(false);
    expect(nopptGenerate).not.toHaveBeenCalled();
    expect(promote).not.toHaveBeenCalled();

    const draftId = openUrl.searchParams.get('draft')!;
    const draft = await readDraft(draftId);
    expect(draft?.params.mode).toBe('auto');
    expect(draft?.params.slideCount).toBe(4);
    expect(draft?.meta.limitApplied).toBe(3200);
    expect(draft?.meta.referenceTextChars).toBe(3200);
    expect(draft?.params.referenceText).toBe(source.slice(0, 3200));
    expect(draft?.params.referenceText).toMatch(/^IMPORTANT-FIRST/);
    expect(draft?.params.referenceText).not.toContain('TAIL-MUST-NOT-REACH');

    // The only persisted JSON is the draft itself; no key or tool response is
    // written by this harness. Read it once to make the no-secret evidence explicit.
    const persisted = readFileSync(join(tempCwd, 'data', 'drafts', `${draftId}.json`), 'utf8');
    expect(persisted).not.toContain('MCP_NOPPT_API_KEY');
  });

  it.each([
    [1, 3000],
    [4, 3200],
    [25, 20000],
  ])('uses clamp(3000, 800 * slideCount, 20000) for %i slides', async (slideCount, expected) => {
    const boundary = createBoundary();
    const response = await boundary.prepareOutlineDraft(
      { topic: '主题', slideCount, referenceText: 'a'.repeat(21_000) },
      createContext(),
    );
    const draftId = new URL(String(response.openUrl)).searchParams.get('draft')!;
    const draft = await readDraft(draftId);
    expect(draft?.meta.limitApplied).toBe(expected);
    expect(draft?.params.referenceText).toHaveLength(expected);
    expect(draft?.meta.truncated).toBe(true);
  });
});
