import { sections, type SectionId } from './constants';
import { useI18n } from '@/i18n';

interface SettingsSidebarProps {
  activeSection: SectionId;
  onSectionChange: (section: SectionId) => void;
}

export default function SettingsSidebar({ activeSection, onSectionChange }: SettingsSidebarProps) {
  const { t } = useI18n();
  return (
    <aside className="w-56 shrink-0">
      <nav className="space-y-1 sticky top-24">
        {sections.map((section) => {
          const Icon = section.icon;
          return (
            <button
              key={section.id}
              onClick={() => onSectionChange(section.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left ${
                activeSection === section.id
                  ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Icon className="w-5 h-5" />
              {t(section.label)}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
