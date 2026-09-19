import type { useSettingsStore } from '@/stores/settings';
import { bindAIModelSettingsHandlers } from '../AIModelSettings.handlers';

/** AIModelSettings 订阅到的完整 settings store 状态（含 action 方法） */
export type AIModelSettingsStore = ReturnType<typeof useSettingsStore.getState>;

/** bindAIModelSettingsHandlers 返回的全部 handler 集合 */
export type AIModelHandlers = ReturnType<typeof bindAIModelSettingsHandlers>;
