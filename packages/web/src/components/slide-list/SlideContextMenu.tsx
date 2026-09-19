import {
  ExternalLink,
  Scissors,
  Copy,
  Clipboard,
  ImageIcon,
  ImageOff,
  Edit3,
  Trash2,
} from 'lucide-react';
import { t } from '@/i18n';

export interface SlideContextMenuProps {
  menuRef: React.RefObject<HTMLDivElement>;
  x: number;
  y: number;
  canPaste: boolean;
  deleteDisabled: boolean;
  onOpenInNewTab: () => void;
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onSetSingleBg: () => void;
  onRemoveSingleBg: () => void;
  onSetAllBg: () => void;
  onRemoveAllBg: () => void;
  onStartRename: () => void;
  onDelete: () => void;
}

/** 幻灯片右键菜单（从 SlideListPanel JSX 下沉，仅接坐标 + 回调） */
export function SlideContextMenu({
  menuRef,
  x,
  y,
  canPaste,
  deleteDisabled,
  onOpenInNewTab,
  onCut,
  onCopy,
  onPaste,
  onSetSingleBg,
  onRemoveSingleBg,
  onSetAllBg,
  onRemoveAllBg,
  onStartRename,
  onDelete,
}: SlideContextMenuProps) {
  return (
    <div
      ref={menuRef}
      className="fixed bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-50 min-w-[140px]"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={onOpenInNewTab}
        className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
      >
        <ExternalLink className="w-4 h-4" />
        {t('在新标签页打开')}
      </button>
      <div className="border-t border-slate-100 my-1" />
      <button
        onClick={onCut}
        className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
      >
        <Scissors className="w-4 h-4" />
        {t('剪切')}
        <span className="ml-auto text-xs text-slate-400">Ctrl+X</span>
      </button>
      <button
        onClick={onCopy}
        className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
      >
        <Copy className="w-4 h-4" />
        {t('复制')}
        <span className="ml-auto text-xs text-slate-400">Ctrl+C</span>
      </button>
      <button
        onClick={onPaste}
        disabled={!canPaste}
        className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Clipboard className="w-4 h-4" />
        {t('粘贴')}
        <span className="ml-auto text-xs text-slate-400">Ctrl+V</span>
      </button>
      <div className="border-t border-slate-100 my-1" />
      <button
        onClick={onSetSingleBg}
        className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
      >
        <ImageIcon className="w-4 h-4" />
        {t('设置本页背景图')}
      </button>
      <button
        onClick={onRemoveSingleBg}
        className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
      >
        <ImageOff className="w-4 h-4" />
        {t('移除本页背景图')}
      </button>
      <div className="border-t border-slate-100 my-1" />
      <button
        onClick={onSetAllBg}
        className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
      >
        <ImageIcon className="w-4 h-4" />
        {t('一键设置所有背景图')}
      </button>
      <button
        onClick={onRemoveAllBg}
        className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
      >
        <ImageOff className="w-4 h-4" />
        {t('一键移除所有背景图')}
      </button>
      <div className="border-t border-slate-100 my-1" />
      <button
        onClick={onStartRename}
        className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
      >
        <Edit3 className="w-4 h-4" />
        {t('重命名')}
      </button>
      <button
        onClick={onDelete}
        disabled={deleteDisabled}
        className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Trash2 className="w-4 h-4" />
        {t('删除')}
        <span className="ml-auto text-xs text-red-300">Delete</span>
      </button>
    </div>
  );
}
