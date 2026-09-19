import { t } from '@/i18n';
import {
  Scissors,
  Copy,
  ClipboardPaste,
  Image as ImageIcon,
  Type,
  Table2,
  Trash2,
} from 'lucide-react';
import type { IconStyleOption } from '@/constants/iconStyles';
import type { IconStyle } from '@/utils/iconReplacer';
import type { ContextMenuState } from '@/hooks/useSelection';
import type { ContextMenuProps } from './types';

interface MenuActions {
  onCut: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onPaste: () => void;
  onPasteAsImage: () => void;
  onPasteSlideAsImage: () => void;
  onPasteText: () => void;
  onPasteHtml: () => void;
  onPasteImage: () => void;
}

interface MenuInnerProps {
  contextMenu: ContextMenuState;
  iconStyleOptions: IconStyleOption[];
  actions: MenuActions;
  onApplyIconStyleToCurrentSlide: (style: IconStyle) => void;
}

function ElementMenu({ contextMenu, actions }: MenuInnerProps) {
  return (
    <>
      <button
        onClick={actions.onCut}
        className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
      >
        <Scissors className="w-4 h-4" />
        {t('剪切')}
      </button>
      <button
        onClick={actions.onCopy}
        className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
      >
        <Copy className="w-4 h-4" />
        {t('复制')}
      </button>
      {contextMenu.hasElementClipboard && (
        <button
          onClick={actions.onPaste}
          className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
        >
          <ClipboardPaste className="w-4 h-4" />
          {t('粘贴元素')}
        </button>
      )}
      {contextMenu.hasElementClipboard && (
        <button
          onClick={actions.onPasteAsImage}
          className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
        >
          <ImageIcon className="w-4 h-4" />
          {t('粘贴为绑定对象')}
        </button>
      )}
      {contextMenu.hasSlideClipboard && (
        <button
          onClick={actions.onPasteSlideAsImage}
          className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
        >
          <ImageIcon className="w-4 h-4" />
          {t('粘贴幻灯片为绑定对象')}
        </button>
      )}
      {contextMenu.hasTextClipboard &&
        !contextMenu.hasElementClipboard &&
        !contextMenu.hasSlideClipboard && (
          <button
            onClick={actions.onPasteText}
            className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
          >
            <Type className="w-4 h-4" />
            {t('粘贴为文本')}
          </button>
        )}
      {contextMenu.hasHtmlClipboard &&
        !contextMenu.hasElementClipboard &&
        !contextMenu.hasSlideClipboard && (
          <button
            onClick={actions.onPasteHtml}
            className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
          >
            <Table2 className="w-4 h-4" />
            {t('粘贴为表格')}
          </button>
        )}
      {contextMenu.hasImageClipboard &&
        !contextMenu.hasElementClipboard &&
        !contextMenu.hasSlideClipboard && (
          <button
            onClick={actions.onPasteImage}
            className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
          >
            <ImageIcon className="w-4 h-4" />
            {t('粘贴图片')}
          </button>
        )}
      <div className="h-px bg-slate-200 my-1" />
      <button
        onClick={actions.onDelete}
        className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
      >
        <Trash2 className="w-4 h-4" />
        {t('删除')}
      </button>
    </>
  );
}

function SlideMenu({ contextMenu, iconStyleOptions, actions, onApplyIconStyleToCurrentSlide }: MenuInnerProps) {
  const emptyClipboard =
    !contextMenu.hasElementClipboard &&
    !contextMenu.hasSlideClipboard &&
    !contextMenu.hasTextClipboard &&
    !contextMenu.hasHtmlClipboard &&
    !contextMenu.hasImageClipboard;
  return (
    <>
      {contextMenu.hasElementClipboard && (
        <button
          onClick={actions.onPaste}
          className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
        >
          <ClipboardPaste className="w-4 h-4" />
          {t('粘贴元素')}
        </button>
      )}
      {contextMenu.hasElementClipboard && (
        <button
          onClick={actions.onPasteAsImage}
          className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
        >
          <ImageIcon className="w-4 h-4" />
          {t('粘贴为绑定对象')}
        </button>
      )}
      {contextMenu.hasSlideClipboard && (
        <button
          onClick={actions.onPasteSlideAsImage}
          className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
        >
          <ImageIcon className="w-4 h-4" />
          {t('粘贴幻灯片为绑定对象')}
        </button>
      )}
      {contextMenu.hasTextClipboard &&
        !contextMenu.hasElementClipboard &&
        !contextMenu.hasSlideClipboard && (
          <button
            onClick={actions.onPasteText}
            className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
          >
            <Type className="w-4 h-4" />
            {t('粘贴为文本')}
          </button>
        )}
      {contextMenu.hasHtmlClipboard &&
        !contextMenu.hasElementClipboard &&
        !contextMenu.hasSlideClipboard && (
          <button
            onClick={actions.onPasteHtml}
            className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
          >
            <Table2 className="w-4 h-4" />
            {t('粘贴为表格')}
          </button>
        )}
      {contextMenu.hasImageClipboard &&
        !contextMenu.hasElementClipboard &&
        !contextMenu.hasSlideClipboard && (
          <button
            onClick={actions.onPasteImage}
            className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
          >
            <ImageIcon className="w-4 h-4" />
            {t('粘贴图片')}
          </button>
        )}
      <div className="h-px bg-slate-200 my-1" />
      <div className="px-2 py-1">
        <p className="px-2 py-1 text-xs font-medium text-slate-400 uppercase tracking-wider">
          {t('图标风格（当前页）')}
        </p>
        {iconStyleOptions.map((opt) => {
          const IconComp = opt.icon;
          return (
            <button
              key={opt.id}
              onClick={() => onApplyIconStyleToCurrentSlide(opt.id as any)}
              className="w-full px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2 rounded"
            >
              <IconComp className="w-4 h-4 text-slate-500" />
              <span>{t(opt.name)}</span>
              <span className="text-xs text-slate-400 ml-auto">{t(opt.desc)}</span>
            </button>
          );
        })}
      </div>
      {emptyClipboard && <div className="h-px bg-slate-200 my-1" />}
      {emptyClipboard && (
        <div className="px-4 py-2 text-sm text-slate-400 text-center">{t('剪贴板为空')}</div>
      )}
    </>
  );
}

export function ContextMenu({
  contextMenu,
  contextMenuRef,
  iconStyleOptions,
  onCut,
  onCopy,
  onPaste,
  onPasteAsImage,
  onPasteSlideAsImage,
  onPasteText,
  onPasteHtml,
  onPasteImage,
  onDeleteElement,
  onApplyIconStyleToCurrentSlide,
}: ContextMenuProps) {
  if (!contextMenu) return null;
  const actions: MenuActions = {
    onCut,
    onCopy,
    onDelete: onDeleteElement,
    onPaste,
    onPasteAsImage: () => onPasteAsImage(contextMenu.x, contextMenu.y),
    onPasteSlideAsImage: () => onPasteSlideAsImage(contextMenu.x, contextMenu.y),
    onPasteText: () => onPasteText(contextMenu.x, contextMenu.y),
    onPasteHtml: () => onPasteHtml(contextMenu.x, contextMenu.y),
    onPasteImage: () => onPasteImage(contextMenu.x, contextMenu.y),
  };
  return (
    <div
      ref={contextMenuRef}
      className="fixed z-50 bg-white rounded-lg shadow-xl border border-slate-200 py-1 min-w-[160px]"
      style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
      onClick={(e) => e.stopPropagation()}
    >
      {contextMenu.type === 'element' ? (
        <ElementMenu contextMenu={contextMenu} iconStyleOptions={iconStyleOptions} actions={actions} onApplyIconStyleToCurrentSlide={onApplyIconStyleToCurrentSlide} />
      ) : (
        <SlideMenu contextMenu={contextMenu} iconStyleOptions={iconStyleOptions} actions={actions} onApplyIconStyleToCurrentSlide={onApplyIconStyleToCurrentSlide} />
      )}
    </div>
  );
}
