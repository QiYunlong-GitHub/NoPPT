import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@/utils/api';
import { configApi } from '@/utils/api';
import { useSettingsStore } from './settings';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

describe('settings async race guards', () => {
  it('keeps a newer settings load from being overwritten by an older response', async () => {
    const first = deferred<AppConfig>();
    const second = deferred<AppConfig>();
    const get = vi
      .spyOn(configApi, 'get')
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const oldLoad = useSettingsStore.getState().loadSettings();
    const newLoad = useSettingsStore.getState().loadSettings();
    second.resolve({
      defaultModelProvider: 'anthropic',
      interfaceSettings: { language: 'en' },
    } as AppConfig);
    await newLoad;
    first.resolve({
      defaultModelProvider: 'ollama',
      interfaceSettings: { language: 'zh-CN' },
    } as AppConfig);
    await oldLoad;

    expect(useSettingsStore.getState().defaultModelProvider).toBe('anthropic');
    expect(useSettingsStore.getState().interfaceSettings.language).toBe('en');
    get.mockRestore();
  });
});
