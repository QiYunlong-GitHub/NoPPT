import { beforeEach, describe, expect, it } from 'vitest';
import { prefillFromDraft, useUIStore } from './ui';
import type { DraftPrefill } from '@/utils/api';

/** 配置页预填：store 读写、一次性消费、草稿视图映射。 */
describe('ui store 预填', () => {
  beforeEach(() => {
    useUIStore.setState({ showAIGenerateModal: false, aiPrefill: null });
  });

  it('默认无预填，开关弹窗不产生预填', () => {
    expect(useUIStore.getState().aiPrefill).toBeNull();
    useUIStore.getState().setAIGenerateModal(true);
    expect(useUIStore.getState().showAIGenerateModal).toBe(true);
    expect(useUIStore.getState().aiPrefill).toBeNull();
  });

  it('setAIGenerateModal 第二参写入预填（单参调用保持兼容）', () => {
    useUIStore.getState().setAIGenerateModal(true, { topic: 'A' });
    expect(useUIStore.getState().aiPrefill?.topic).toBe('A');
    useUIStore.getState().setAIGenerateModal(false);
    expect(useUIStore.getState().aiPrefill?.topic).toBe('A');
  });

  it('consumeAIPrefill 一次性消费后置空', () => {
    useUIStore.getState().setAIPrefill({ topic: 'B' });
    expect(useUIStore.getState().consumeAIPrefill()?.topic).toBe('B');
    expect(useUIStore.getState().consumeAIPrefill()).toBeNull();
    expect(useUIStore.getState().aiPrefill).toBeNull();
  });

  it('prefillFromDraft 映射草稿视图且不含内部字段', () => {
    const draft: DraftPrefill = {
      draftId: 'drf_x',
      topic: '季度复盘',
      referenceText: '素材',
      referenceSource: '企业知识库 / RAG',
      referenceLimit: 6400,
      referenceTruncated: true,
      referenceOriginalChars: 20000,
      style: 'tech',
      audience: '管理层',
      slideCount: 8,
      colorTheme: 'blue',
      fontFamily: 'sans',
      iconStyle: 'auto',
      mode: 'auto',
      expiresAt: Date.now() + 1000,
    };
    const payload = prefillFromDraft(draft);
    expect(payload).toMatchObject({
      topic: '季度复盘',
      referenceText: '素材',
      referenceSource: '企业知识库 / RAG',
      referenceLimit: 6400,
      referenceTruncated: true,
      referenceOriginalChars: 20000,
      audience: '管理层',
      slideCount: 8,
      mode: 'auto',
    });
    expect(Object.keys(payload)).not.toContain('draftId');
    expect(Object.keys(payload)).not.toContain('expiresAt');
  });
});
