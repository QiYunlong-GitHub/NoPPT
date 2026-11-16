import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AIGenerateModal from '../AIGenerateModal';
import { aiApi } from '@/utils/api';
import { useSettingsStore } from '@/stores/settings';
import { useUIStore } from '@/stores/ui';

vi.mock('@/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/api')>();
  return {
    ...actual,
    aiApi: {
      ...actual.aiApi,
      planPresentation: vi.fn(),
      generateDesignProposals: vi.fn(),
      renderSlides: vi.fn(),
      assembleImages: vi.fn(),
      finalizePresentation: vi.fn(),
      generatePresentation: vi.fn(),
      generateFromPlan: vi.fn(),
    },
  };
});

const generatedPlan = {
  title: '厄尔尼诺',
  primaryColor: '#ea580c',
  slides: [
    {
      pageType: 'cover',
      title: '厄尔尼诺',
      keyPoints: [],
      needsImage: false,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn());
  vi.spyOn(useSettingsStore.getState(), 'hasApiKey').mockReturnValue(true);
  useUIStore.setState({ showAIGenerateModal: false, aiPrefill: null });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useUIStore.setState({ showAIGenerateModal: false, aiPrefill: null });
});

describe('AIGenerateModal · 生成错误恢复', () => {
  it('generateDesignProposals 返回 500 后退出 generating 遮罩，回到大纲并保留主题输入', async () => {
    vi.mocked(aiApi.planPresentation).mockResolvedValue(generatedPlan as any);
    vi.mocked(aiApi.generateDesignProposals).mockRejectedValue(
      new Error('API Error: 500 Internal Server Error'),
    );

    useUIStore.getState().setAIPrefill({
      topic: '厄尔尼诺：现象、影响与应对',
      referenceText: 'IMPORTANT-FIRST',
      referenceLimit: 3200,
      referenceTruncated: false,
      referenceOriginalChars: 15,
      mode: 'auto',
    });

    render(<AIGenerateModal open onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByDisplayValue('厄尔尼诺：现象、影响与应对')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('🚀 一键生成'));

    await waitFor(() => {
      expect(aiApi.generateDesignProposals).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.queryByText('正在匹配设计方案...')).toBeNull();
      expect(screen.getByText('确认大纲，继续')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('返回修改'));
    await waitFor(() => {
      expect(screen.getByDisplayValue('厄尔尼诺：现象、影响与应对')).toBeTruthy();
    });
  });
});
