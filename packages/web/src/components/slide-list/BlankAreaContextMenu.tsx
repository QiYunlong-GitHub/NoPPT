import { Clipboard, ImageIcon, ImageOff, Plus } from 'lucide-react';
import { t } from '@/i18n';

export interface BlankAreaContextMenuProps {
  menuRef: React.RefObject<HTMLDivElement>;
  x: number;
  y: number;
  canPaste: boolean;
  slidesCount: number;
  onPaste: (index: number) => void;
  onSetAllBg: () => void;
  onRemoveAllBg: () => void;
  onAddSlide: () => void;
}

/** 列表空白区右键菜单（从 SlideListPanel JSX 下沉，仅接坐标 + 回调） */
export function BlankAreaContextMenu({
  menuRef,
  x,
  y,
  canPaste,
  slidesCount,
  onPaste,
  onSetAllBg,
  onRemoveAllBg,
  onAddSlide,
}: BlankAreaContextMenuProps) {
  return (
    <div
      ref={menuRef}
      className="fixed bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-50 min-w-[160px]"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={() => onPaste(slidesCount)}
        disabled={!canPaste}
        className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Clipboard className="w-4 h-4" />
        {canPaste ? t('粘贴') : t('剪贴板为空')}
        <span className="ml-auto text-xs text-slate-400">Ctrl+V</span>
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
      <button
        onClick={onAddSlide}
        className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
      >
        <Plus className="w-4 h-4" />
        {t('新增幻灯片')}
      </button>
    </div>
  );
}
