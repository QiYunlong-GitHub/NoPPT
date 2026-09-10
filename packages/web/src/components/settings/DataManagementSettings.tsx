import { Download, Upload, RotateCcw, Trash2 } from 'lucide-react';
import { useSettingsStore } from '@/stores/settings';
import { usePresentationStore } from '@/stores/presentation';
import { useUIStore } from '@/stores/ui';
import { sanitizeConfigForExport } from './utils';
import {useI18n, t} from '@/i18n';
interface DataManagementSettingsProps {
    onShowResetConfirm: () => void;
    onShowClearConfirm: () => void;
}
export default function DataManagementSettings({ onShowResetConfirm, onShowClearConfirm, }: DataManagementSettingsProps) {
    const settings = useSettingsStore();
    const presentations = usePresentationStore();
    const showToast = useUIStore((s) => s.showToast);
    const { t } = useI18n();
    const handleExportConfig = () => {
        const rawConfig = {
            defaultModelProvider: settings.defaultModelProvider,
            modelRouting: settings.modelRouting,
            apiConfig: settings.apiConfig,
            imageGeneration: settings.imageGeneration,
            interfaceSettings: settings.interfaceSettings,
            exportSettings: settings.exportSettings,
            editorSettings: settings.editorSettings,
            logSettings: settings.logSettings,
            auditSettings: settings.auditSettings,
            inlineSelfCheckSettings: settings.inlineSelfCheckSettings,
        };
        const sanitized = sanitizeConfigForExport(rawConfig);
        const config = {
            type: 'config',
            version: '1.0.0',
            exportedAt: new Date().toISOString(),
            _note: 'NoPPT 配置文件（不含API Key），API Key 需要手动填写后使用',
            ...sanitized,
        };
        const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `noppt-config-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast(t('配置已导出（API Key已自动脱敏）'), 'success');
    };
    const handleImportConfig = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file)
            return;
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const data = JSON.parse(event.target?.result as string);
                applySettingsFromData(data.settings || data, true);
                await settings.saveSettings();
                showToast(t('配置导入成功（API Key 保留原有值）'), 'success');
            }
            catch {
                showToast(t('导入失败：文件格式不正确'), 'error');
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };
    const applySettingsFromData = (data: any, preserveApiKeys: boolean = true) => {
        const currentApiKeys: Record<string, string> = {};
        if (preserveApiKeys && data.apiConfig) {
            for (const key of Object.keys(settings.apiConfig)) {
                currentApiKeys[key] = settings.apiConfig[key as keyof typeof settings.apiConfig].apiKey;
            }
        }
        const currentImageApiKeys: Record<string, string> = {};
        if (preserveApiKeys && data.imageGeneration?.providers) {
            for (const key of Object.keys(settings.imageGeneration.providers)) {
                currentImageApiKeys[key] = settings.imageGeneration.providers[key as keyof typeof settings.imageGeneration.providers].apiKey;
            }
        }
        if (data.apiConfig) {
            Object.keys(data.apiConfig).forEach((key) => {
                const providerKey = key as keyof typeof settings.apiConfig;
                const updateFnMap: Record<string, (config: any) => void> = {
                    openai: settings.updateOpenAIConfig,
                    anthropic: settings.updateAnthropicConfig,
                    ollama: settings.updateOllamaConfig,
                    freeai: settings.updateFreeAIConfig,
                    v0: settings.updateV0Config,
                    'company-gateway': settings.updateCompanyGatewayConfig,
                };
                if (updateFnMap[key]) {
                    const importedConfig = { ...data.apiConfig[key] };
                    if (preserveApiKeys && (!importedConfig.apiKey || importedConfig.apiKey === '')) {
                        importedConfig.apiKey = currentApiKeys[key] || '';
                    }
                    if (importedConfig.model && !importedConfig.models) {
                        importedConfig.models = [importedConfig.model];
                        delete importedConfig.model;
                    }
                    updateFnMap[key](importedConfig);
                }
            });
        }
        if (data.defaultModelProvider) {
            settings.setDefaultProvider(data.defaultModelProvider);
        }
        if (data.modelRouting) {
            settings.updateModelRouting(data.modelRouting);
        }
        if (data.interfaceSettings) {
            settings.updateInterfaceSettings(data.interfaceSettings);
        }
        if (data.exportSettings) {
            settings.updateExportSettings(data.exportSettings);
        }
        if (data.editorSettings) {
            settings.updateEditorSettings(data.editorSettings);
        }
        if (data.logSettings) {
            settings.updateLogSettings(data.logSettings);
        }
        if (data.auditSettings) {
            settings.updateAuditSettings(data.auditSettings);
        }
        if (data.inlineSelfCheckSettings) {
            settings.updateInlineSelfCheckSettings(data.inlineSelfCheckSettings);
        }
        if (data.imageGeneration) {
            const imgConfig = { ...data.imageGeneration };
            if (imgConfig.providers) {
                for (const key of Object.keys(imgConfig.providers)) {
                    if (preserveApiKeys && (!imgConfig.providers[key].apiKey || imgConfig.providers[key].apiKey === '')) {
                        imgConfig.providers[key].apiKey = currentImageApiKeys[key] || '';
                    }
                }
            }
            settings.updateImageGeneration(imgConfig);
        }
    };
    const handleExportPresentations = () => {
        const data = {
            presentations: presentations.presentations,
            exportedAt: new Date().toISOString(),
            version: '1.0.0',
            type: 'presentations',
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `noppt-presentations-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast(t('演示数据已导出'), 'success');
    };
    const handleImportPresentations = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file)
            return;
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const data = JSON.parse(event.target?.result as string);
                if (data.presentations && Array.isArray(data.presentations)) {
                    data.presentations.forEach((p: any) => {
                        presentations.addPresentation(p);
                    });
                    showToast(t('演示数据导入成功，共 {n} 个演示文稿', { n: data.presentations.length }), 'success');
                }
                else {
                    showToast(t('导入失败：文件中未找到演示数据'), 'error');
                }
            }
            catch {
                showToast(t('导入失败：文件格式不正确'), 'error');
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };
    return (<>
      <section className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t('数据管理')}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t('管理您的本地数据')}</p>
        </div>
        <div className="p-6 space-y-4">
          {/* 配置数据 */}
          <div className="mb-2">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-3 uppercase tracking-wider">{t('配置数据')}</p>
          </div>

          {/* 导出配置 */}
          <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
                <Download className="w-5 h-5 text-purple-600 dark:text-purple-400"/>
              </div>
              <div>
                <p className="font-medium text-slate-900 dark:text-white text-sm">{t('导出配置')}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t('导出 AI 模型、界面设置、导出设置、编辑器设置（API Key 自动脱敏不导出）')}
                </p>
              </div>
            </div>
            <button onClick={handleExportConfig} className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm font-medium">
              {t('导出配置')}
            </button>
          </div>

          {/* 导入配置 */}
          <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg">
                <Upload className="w-5 h-5 text-indigo-600 dark:text-indigo-400"/>
              </div>
              <div>
                <p className="font-medium text-slate-900 dark:text-white text-sm">{t('导入配置')}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t('从配置文件导入设置，API Key 保留当前值不会被覆盖')}
                </p>
              </div>
            </div>
            <label className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium cursor-pointer">
              {t('导入配置')}
              <input type="file" accept=".json" onChange={handleImportConfig} className="hidden"/>
            </label>
          </div>

          {/* 演示数据分隔 */}
          <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-3 uppercase tracking-wider">{t('演示数据')}</p>
          </div>

          {/* 导出演示主数据 */}
          <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
                <Download className="w-5 h-5 text-green-600 dark:text-green-400"/>
              </div>
              <div>
                <p className="font-medium text-slate-900 dark:text-white text-sm">{t('导出演示主数据')}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t('仅导出所有演示文稿主数据，不包含图片视频等资源文件')}
                </p>
              </div>
            </div>
            <button onClick={handleExportPresentations} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium">
              {t('导出主数据')}
            </button>
          </div>

          {/* 导入演示主数据 */}
          <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                <Upload className="w-5 h-5 text-blue-600 dark:text-blue-400"/>
              </div>
              <div>
                <p className="font-medium text-slate-900 dark:text-white text-sm">{t('导入演示主数据')}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t('从演示备份文件导入演示主数据，不影响现有配置')}
                </p>
              </div>
            </div>
            <label className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium cursor-pointer">
              {t('导入主数据')}
              <input type="file" accept=".json" onChange={handleImportPresentations} className="hidden"/>
            </label>
          </div>

          {/* 重置设置 */}
          <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg">
                <RotateCcw className="w-5 h-5 text-yellow-600 dark:text-yellow-400"/>
              </div>
              <div>
                <p className="font-medium text-slate-900 dark:text-white text-sm">{t('重置所有设置')}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t('将设置恢复为默认值，不会删除演示文稿')}
                </p>
              </div>
            </div>
            <button onClick={onShowResetConfirm} className="px-4 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 transition-colors text-sm font-medium">
              {t('重置')}
            </button>
          </div>

          {/* 清空演示数据 */}
          <div className="flex items-center justify-between p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-lg">
                <Trash2 className="w-5 h-5 text-red-600 dark:text-red-400"/>
              </div>
              <div>
                <p className="font-medium text-red-900 dark:text-red-300 text-sm">{t('清空所有演示数据')}</p>
                <p className="text-xs text-red-600 dark:text-red-400">
                  {t('删除所有演示文稿，不影响配置设置，此操作不可撤销')}
                </p>
              </div>
            </div>
            <button onClick={onShowClearConfirm} className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium">
              {t('清空演示')}
            </button>
          </div>
        </div>
      </section>

      <section className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
          <strong className="text-slate-900 dark:text-white">{t("💡")}{t('数据存储提示：')}</strong>
          {t('演示文稿数据保存在服务器端，AI 模型等配置信息保存在 data/config.json 文件中。您可以直接编辑该配置文件或通过本页面修改配置，两种方式效果相同。')}
        </p>
        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mt-2">
          <strong className="text-amber-600 dark:text-amber-400">{t("🔒")}{t('安全提示：')}</strong>
          {t('导出配置功能会自动对所有 API Key 进行脱敏处理（清空），不会导出密钥。导入配置时，API Key 字段若为空则保留当前系统中已有的值，不会被覆盖。')}
        </p>
        {settings.configSource && (<p className="text-xs text-slate-500 dark:text-slate-500 mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
            {t('当前配置来源：')}
            {settings.configSource === 'file' && <span className="text-green-600 dark:text-green-400 font-medium">{t('✓ 配置文件（data/config.json）')}</span>}
            {settings.configSource === 'local' && <span className="text-amber-600 dark:text-amber-400 font-medium">{t('⚠ 浏览器本地存储（配置文件未找到或无法访问）')}</span>}
            {settings.configSource === 'default' && <span className="text-slate-600 dark:text-slate-400 font-medium">{t('默认配置')}</span>}
          </p>)}
      </section>
    </>);
}
