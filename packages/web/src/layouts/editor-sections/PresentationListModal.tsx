import { t } from '@/i18n';
import { X, Settings } from 'lucide-react';
import type { PresentationListModalProps } from './types';

export function PresentationListModal({
  open,
  presentations,
  currentId,
  onSelect,
  onClose,
}: PresentationListModalProps) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-[500px] max-h-[70vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-slate-200">
          <h3 className="text-base font-semibold text-slate-800">{t('打开演示')}</h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {presentations.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm">{t('暂无演示文稿')}</div>
          ) : (
            <div className="space-y-2">
              {presentations.map((item) => (
                <button
                  key={item.id}
                  onClick={() => onSelect(item.id)}
                  className={`w-full text-left p-3 rounded-lg transition-colors flex items-center gap-3 ${
                    item.id === currentId
                      ? 'bg-blue-50 border border-blue-200'
                      : 'hover:bg-slate-50 border border-transparent'
                  }`}
                >
                  <div className="w-12 h-12 bg-slate-100 rounded-lg flex items-center justify-center shrink-0">
                    <Settings className="w-6 h-6 text-slate-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-slate-800 truncate">{item.title}</div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {item.slideCount} {t('页')} · {new Date(item.updatedAt).toLocaleDateString()}
                    </div>
                  </div>
                  {item.id === currentId && (
                    <span className="text-xs text-blue-600 font-medium shrink-0">
                      {t('当前')}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
