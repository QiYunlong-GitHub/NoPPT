// ================================================================
// AIModelSettings —— 行为锁定测试（characterization / 回归基线）
//
// 背景：AIModelSettings.tsx（~1687 行，巨型表单）零覆盖。
//       计划将内部 5 个粗粒度 JSX 区块下沉为展示型子组件
//       （保留 useState/setter、handler 原样，子组件仅接 value+回调）。
//       本文件先锁定「各配置区块标题渲染」「测试连接按钮存在」
//       「section 区块数为 5」这些最基本结构，确保下沉不改变渲染 DOM。
// ================================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { I18nProvider } from '@/i18n/I18nProvider';
import AIModelSettings from '../settings/AIModelSettings';
import { useSettingsStore } from '@/stores/settings';

afterEach(() => cleanup());

beforeEach(() => {
  // 图片生成区块默认关闭（imageGeneration.enabled=false），会隐藏「图片供应商」
  // 与「测试连接」区块。仅把 enabled 置 true（保留其余默认字段）以扩大回归覆盖。
  useSettingsStore.setState((s: any) => ({
    imageGeneration: { ...(s.imageGeneration ?? {}), enabled: true },
  }));
});

describe('AIModelSettings（行为锁定 / 回归基线）', () => {
  it('完整挂载并渲染各配置区块标题', () => {
    const { getByText, getAllByText, container } = render(
      <I18nProvider>
        <AIModelSettings onTestConnection={vi.fn()} testing={false} testResult={null} />
      </I18nProvider>,
    );
    expect(container.firstChild).toBeTruthy();
    // 始终渲染的 4 个 section 标题
    expect(getByText('默认模型提供商')).toBeTruthy();
    expect(getByText('模型路由设置')).toBeTruthy();
    expect(getByText('AI 内联自检设置')).toBeTruthy();
    expect(getByText('AI 审核设置')).toBeTruthy();
    // 「测试连接」按钮共 2 个：默认模型提供商区（始终渲染）+ 图片生成区（enabled 后渲染）
    expect(getAllByText('测试连接').length).toBe(2);
  });

  it('粗粒度区块数稳定：7 个 <section>', () => {
    const { container } = render(
      <I18nProvider>
        <AIModelSettings onTestConnection={vi.fn()} testing={false} testResult={null} />
      </I18nProvider>,
    );
    // 7 个 <section>：默认模型提供商 / Provider Config / 模型路由设置 /
    // AI 内联自检设置 / AI 审核设置 / 图片生成配置（enabled）/ 隐私提示
    expect(container.querySelectorAll('section').length).toBe(7);
  });
});
