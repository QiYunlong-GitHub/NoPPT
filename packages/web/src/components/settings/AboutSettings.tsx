import { useI18n } from '@/i18n';

export default function AboutSettings() {
  const { t } = useI18n();
  return (
    <section className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
      <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t('关于 NoPPT')}</h2>
      </div>
      <div className="p-6">
        <div className="flex items-start gap-4 mb-6">
          <img
            src="/NoPPT.ico"
            alt="NoPPT"
            className="w-16 h-16 rounded-2xl shrink-0"
          />
          <div>
            <h3 className="text-2xl font-bold text-slate-900 dark:text-white">NoPPT</h3>
            <p className="text-slate-500 dark:text-slate-400 mt-1">{t('版本 1.0.0 (MVP)')}</p>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
              {t('开源、高性能、可私有化部署的卡片式 AI 演示平台')}
            </p>
          </div>
        </div>

        <div className="space-y-4 text-sm">
          <div className="flex justify-between py-2 border-b border-slate-100 dark:border-slate-700">
            <span className="text-slate-500 dark:text-slate-400">{t('许可证')}</span>
            <span className="font-medium text-slate-900 dark:text-white">MIT License</span>
          </div>
          <div className="flex justify-between py-2 border-b border-slate-100 dark:border-slate-700">
            <span className="text-slate-500 dark:text-slate-400">{t('技术栈')}</span>
            <span className="font-medium text-slate-900 dark:text-white">React + TypeScript + Vite</span>
          </div>
          <div className="flex justify-between py-2 border-b border-slate-100 dark:border-slate-700">
            <span className="text-slate-500 dark:text-slate-400">{t('状态管理')}</span>
            <span className="font-medium text-slate-900 dark:text-white">Zustand + Immer</span>
          </div>
          <div className="flex justify-between py-2 border-b border-slate-100 dark:border-slate-700">
            <span className="text-slate-500 dark:text-slate-400">{t('样式方案')}</span>
            <span className="font-medium text-slate-900 dark:text-white">TailwindCSS</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-slate-500 dark:text-slate-400">{t('数据存储')}</span>
            <span className="font-medium text-slate-900 dark:text-white">{t('本地服务器')}</span>
          </div>
        </div>

        <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
          <p className="text-sm text-blue-800 dark:text-blue-400 leading-relaxed font-mono mb-2">
            NoPPT : PPT = NoSQL : SQL. NoPPT is a web-first, AI &amp; cloud native platform for slide generation, editing and sharing.
          </p>
          <p className="text-sm text-blue-800 dark:text-blue-400 leading-relaxed">
            {t('NoPPT之于传统 PPT，正如非关系型数据库之于关系型数据库。NoPPT 是网页优先、AI 原生+云原生的幻灯片创作编辑分享平台。')}
          </p>
        </div>
      </div>
    </section>
  );
}
