import { useUIStore } from '@/stores/ui';
import { Check, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';

export default function Toast() {
  const toast = useUIStore((s) => s.toast);
  const hideToast = useUIStore((s) => s.hideToast);

  if (!toast || !toast.visible) return null;

  const iconMap = {
    success: Check,
    error: AlertCircle,
    info: Info,
    warning: AlertTriangle,
  };

  const colorMap = {
    success: 'bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800 text-green-800 dark:text-green-300',
    error: 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300',
    info: 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-300',
    warning: 'bg-amber-50 dark:bg-amber-900/30 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300',
  };

  const iconColorMap = {
    success: 'text-green-600 dark:text-green-400',
    error: 'text-red-600 dark:text-red-400',
    info: 'text-blue-600 dark:text-blue-400',
    warning: 'text-amber-600 dark:text-amber-400',
  };

  const Icon = iconMap[toast.type];

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 animate-fade-in">
      <div
        className={`flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg ${colorMap[toast.type]}`}
      >
        <Icon className={`w-5 h-5 ${iconColorMap[toast.type]} flex-shrink-0`} />
        <span className="text-sm font-medium">{toast.message}</span>
        <button
          onClick={hideToast}
          className="ml-2 p-0.5 hover:bg-black/5 dark:hover:bg-white/10 rounded transition-colors"
        >
          <X className="w-4 h-4 opacity-60" />
        </button>
      </div>
    </div>
  );
}
