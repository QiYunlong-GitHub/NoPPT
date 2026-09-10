import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  buildOpenUrl,
  createDraft,
  purgeExpiredDrafts,
  readDraft,
  readDraftIncludingExpired,
  referenceTextLimit,
  signDraftToken,
  toPrefillView,
  verifyDraftToken,
  DRAFT_ID_PREFIX,
} from './draft-store';
import { readMcpEnv } from '../../common/env';

/**
 * 生成草稿底座（IM 拟题 + Web 确认生成）：
 * id 随机性、素材分档裁剪、签名验签、scope 越权、过期清理。
 */
describe('draft-store', () => {
  let originalCwd: string;
  let tmp: string;

  /** 把已落盘草稿的 expiresAt 改到过去，模拟过期。 */
  function expireDraft(rec: { draftId: string }): { draftId: string } {
    const { writeFileSync, readFileSync } = require('fs') as typeof import('fs');
    const file = join(process.cwd(), 'data', 'drafts', `${rec.draftId}.json`);
    const raw = JSON.parse(readFileSync(file, 'utf-8'));
    raw.expiresAt = Date.now() - 1000;
    writeFileSync(file, JSON.stringify(raw), 'utf-8');
    return rec;
  }

  beforeEach(() => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'noppt-draft-'));
    process.chdir(tmp);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  describe('referenceTextLimit', () => {
    it('按页数线性增长并受上下限约束', () => {
      const limit8 = referenceTextLimit(8, 20000);
      expect(limit8).toBe(6400);
      // 页数极少 → 抬到下限 3000
      expect(referenceTextLimit(1, 20000)).toBe(3000);
      // 页数极多 → 压到上限
      expect(referenceTextLimit(40, 20000)).toBe(20000);
    });

    it('缺省页数按 8 页计算', () => {
      expect(referenceTextLimit(undefined, 20000)).toBe(6400);
    });
  });

  describe('createDraft', () => {
    it('生成随机不可猜的 draftId 并落盘', async () => {
      const a = await createDraft({ topic: 'A 主题' }, { tenant: 'hermes', user: 'local' });
      const b = await createDraft({ topic: 'B 主题' }, { tenant: 'hermes', user: 'local' });
      expect(a.draftId).toMatch(/^drf_[a-f0-9]{32}$/);
      expect(a.draftId).not.toBe(b.draftId);
      expect(existsSync(join(process.cwd(), 'data', 'drafts', `${a.draftId}.json`))).toBe(true);
    });

    it('素材按页数分档裁剪并记录 originalChars / limitApplied / truncated', async () => {
      const rec = await createDraft(
        { topic: '长素材', referenceText: '素'.repeat(20000), slideCount: 8 },
        { tenant: 'hermes', user: 'local' },
        '企业知识库 / RAG',
      );
      expect(rec.meta.truncated).toBe(true);
      expect(rec.meta.originalChars).toBe(20000);
      expect(rec.meta.limitApplied).toBe(6400);
      expect(rec.params.referenceText).toHaveLength(6400);
      expect(rec.meta.source).toBe('企业知识库 / RAG');
    });

    it('未超限时原样保留素材', async () => {
      const rec = await createDraft(
        { topic: '短素材', referenceText: '素材内容', slideCount: 8 },
        { tenant: 'hermes', user: 'local' },
      );
      expect(rec.meta.truncated).toBe(false);
      expect(rec.params.referenceText).toBe('素材内容');
    });

    it('模式缺省预选 auto，可显式指定 guided', async () => {
      expect(
        (await createDraft({ topic: 'x' }, { tenant: 'hermes', user: 'local' })).params.mode,
      ).toBe('auto');
      expect(
        (await createDraft({ topic: 'x', mode: 'guided' }, { tenant: 'hermes', user: 'local' }))
          .params.mode,
      ).toBe('guided');
    });

    it('页数越界被夹到 1~40', async () => {
      expect(
        (await createDraft({ topic: 'x', slideCount: 999 }, { tenant: 'hermes', user: 'local' }))
          .params.slideCount,
      ).toBe(40);
      expect(
        (await createDraft({ topic: 'x', slideCount: 0 }, { tenant: 'hermes', user: 'local' }))
          .params.slideCount,
      ).toBe(1);
    });
  });

  describe('签名与深链', () => {
    it('签名可验证，篡改 draftId / tenant / user / exp 任一即失败', async () => {
      const rec = await createDraft({ topic: 'x' }, { tenant: 'hermes', user: 'local' });
      const token = signDraftToken(rec.draftId, 'hermes', 'local', rec.expiresAt);
      expect(verifyDraftToken(token, rec.draftId, 'hermes', 'local', rec.expiresAt)).toBe(true);
      expect(
        verifyDraftToken(token, 'drf_' + 'f'.repeat(32), 'hermes', 'local', rec.expiresAt),
      ).toBe(false);
      expect(verifyDraftToken(token, rec.draftId, 'other', 'local', rec.expiresAt)).toBe(false);
      expect(verifyDraftToken(token, rec.draftId, 'hermes', 'other', rec.expiresAt)).toBe(false);
      expect(verifyDraftToken(token, rec.draftId, 'hermes', 'local', rec.expiresAt + 1)).toBe(
        false,
      );
    });

    it('空 token / 长度不符不抛异常且判为无效', async () => {
      const rec = await createDraft({ topic: 'x' }, { tenant: 'hermes', user: 'local' });
      expect(verifyDraftToken('', rec.draftId, 'hermes', 'local', rec.expiresAt)).toBe(false);
      expect(verifyDraftToken('abc', rec.draftId, 'hermes', 'local', rec.expiresAt)).toBe(false);
    });

    it('openUrl 含 ai/draft/t/u/token 且基于 webUrl', async () => {
      const rec = await createDraft({ topic: 'x' }, { tenant: 'hermes', user: 'local' });
      const url = buildOpenUrl(rec);
      expect(url.startsWith(`${readMcpEnv().webUrl}/?`)).toBe(true);
      const q = new URLSearchParams(url.split('?')[1]);
      expect(q.get('ai')).toBe('1');
      expect(q.get('draft')).toBe(rec.draftId);
      expect(q.get('t')).toBe('hermes');
      expect(q.get('u')).toBe('local');
      expect(q.get('token')).toBe(signDraftToken(rec.draftId, 'hermes', 'local', rec.expiresAt));
    });
  });

  describe('readDraft', () => {
    it('读回完整草稿', async () => {
      const rec = await createDraft(
        { topic: '读回', referenceText: '素材' },
        { tenant: 'hermes', user: 'local' },
      );
      const got = await readDraft(rec.draftId);
      expect(got?.params.topic).toBe('读回');
      expect(got?.params.referenceText).toBe('素材');
    });

    it('非法 draftId（含路径穿越）一律返回 null', async () => {
      await createDraft({ topic: 'x' }, { tenant: 'hermes', user: 'local' });
      expect(await readDraft('../apikeys')).toBeNull();
      expect(await readDraft(`${DRAFT_ID_PREFIX}zzzz`)).toBeNull();
      expect(await readDraft('')).toBeNull();
    });

    it('过期草稿视为不存在（读取时顺带删除）', async () => {
      const rec = expireDraft(
        await createDraft({ topic: 'x' }, { tenant: 'hermes', user: 'local' }),
      );
      expect(await readDraft(rec.draftId)).toBeNull();
      expect(existsSync(join(process.cwd(), 'data', 'drafts', `${rec.draftId}.json`))).toBe(false);
    });

    it('readDraftIncludingExpired 可判定已过期（用于区分 E5007 / E5008）', async () => {
      const rec = expireDraft(
        await createDraft({ topic: 'x' }, { tenant: 'hermes', user: 'local' }),
      );
      const expired = await readDraftIncludingExpired(rec.draftId);
      expect(expired?.draftId).toBe(rec.draftId);
      expect(expired!.expiresAt).toBeLessThan(Date.now());
    });
  });

  describe('purgeExpiredDrafts', () => {
    it('只清理过期草稿', async () => {
      const live = await createDraft({ topic: 'live' }, { tenant: 'hermes', user: 'local' });
      const old = expireDraft(
        await createDraft({ topic: 'old' }, { tenant: 'hermes', user: 'local' }),
      );

      const deleted = await purgeExpiredDrafts();
      expect(deleted).toBe(1);
      expect(await readDraft(old.draftId)).toBeNull();
      expect(await readDraft(live.draftId)).not.toBeNull();
    });
  });

  describe('toPrefillView', () => {
    it('输出供前端预填的脱敏视图', async () => {
      const rec = await createDraft(
        { topic: '预填', referenceText: '素材', slideCount: 10, style: 'tech', mode: 'auto' },
        { tenant: 'hermes', user: 'local' },
        'RAG',
      );
      const view = toPrefillView(rec);
      expect(view).toMatchObject({
        draftId: rec.draftId,
        topic: '预填',
        referenceText: '素材',
        referenceSource: 'RAG',
        slideCount: 10,
        style: 'tech',
        mode: 'auto',
      });
      expect(view.referenceLimit).toBe(referenceTextLimit(10, readMcpEnv().maxRefTextChars));
      // 绝不含 scope 等内部字段
      expect(Object.keys(view)).not.toContain('scope');
    });
  });
});
