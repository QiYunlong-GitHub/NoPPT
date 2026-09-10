import { t } from '@/i18n';
interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  confirmVariant?: 'default' | 'danger' | 'warning';
}
export default function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = t('确认'),
  cancelText = t('取消'),
  confirmVariant = 'default',
}: ConfirmModalProps) {
  if (!isOpen) return null;
  const getConfirmButtonClasses = () => {
    switch (confirmVariant) {
      case 'danger':
        return 'px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium';
      case 'warning':
        return 'px-4 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 text-sm font-medium';
      default:
        return 'px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium';
    }
  };
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-md w-full mx-4 overflow-hidden">
        <div className="p-6">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">{title}</h3>
          <p className="text-sm text-slate-600 dark:text-slate-400">{description}</p>
        </div>
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-700/50 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-slate-300 dark:border-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-sm font-medium text-slate-700"
          >
            {cancelText}
          </button>
          <button onClick={onConfirm} className={getConfirmButtonClasses()}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
