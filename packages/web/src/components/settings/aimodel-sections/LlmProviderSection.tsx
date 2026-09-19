import { t } from '@/i18n';
import { modelProviders } from '../constants';
import type { AIModelSettingsStore } from './types';

interface LlmProviderSectionProps {
  settings: AIModelSettingsStore;
}

export function LlmProviderSection({ settings }: LlmProviderSectionProps) {
  return (
    <section className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
      <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          {t('默认模型提供商')}
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          {t('选择用于 AI 生成演示内容的默认模型服务')}
        </p>
      </div>
      <div className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {modelProviders.map((provider) => {
            const Icon = provider.icon;
            return (
              <button
                key={provider.value}
                onClick={() => settings.setDefaultProvider(provider.value as any)}
                className={`p-4 rounded-xl border-2 text-left transition-all ${
                  settings.defaultModelProvider === provider.value
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500 bg-white dark:bg-slate-800'
                }`}
              >
                <div className="flex items-center gap-3 mb-2">
                  <div
                    className={`p-2 rounded-lg ${
                      settings.defaultModelProvider === provider.value
                        ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400'
                        : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                  </div>
                  <span className="font-medium text-slate-900 dark:text-white">
                    {t(provider.label)}
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">{t(provider.hint)}</p>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
