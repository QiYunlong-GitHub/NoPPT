import { t } from '@/i18n';
import {
  ArrowLeft,
  FolderOpen,
  Save,
  Download,
  Hash,
  Sparkles,
  Undo2,
  Redo2,
  Group as GroupIcon,
  Ungroup as UngroupIcon,
  Table,
  Image as ImageIcon,
  Video,
  Play,
  ZoomOut,
  ZoomIn,
} from 'lucide-react';
import type { IconStyleOption } from '@/constants/iconStyles';
import type { IconStyle } from '@/utils/iconReplacer';
import type { EditorToolbarProps } from './types';

interface IconStyleMenuProps {
  open: boolean;
  onToggle: (open: boolean) => void;
  options: IconStyleOption[];
  onApplyGlobal: (id: string) => void;
  onApplyCurrentSlide: (style: IconStyle) => void;
}

function IconStyleMenu({
  open,
  onToggle,
  options,
  onApplyGlobal,
  onApplyCurrentSlide,
}: IconStyleMenuProps) {
  if (!open) return null;
  return (
    <div className="absolute top-full left-0 mt-1 bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 py-2 z-50 w-52">
      <div className="px-3 py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-700 mb-1">
        {t('全局应用到所有页')}
      </div>
      {options.map((opt) => {
        const IconComp = opt.icon;
        return (
          <button
            key={opt.id}
            onClick={() => onApplyGlobal(opt.id)}
            className="w-full px-3 py-2 flex items-center gap-3 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-left"
          >
            <IconComp className="w-4 h-4 text-slate-500 dark:text-slate-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{t(opt.name)}</p>
              <p className="text-xs text-slate-400 dark:text-slate-500">{t(opt.desc)}</p>
            </div>
          </button>
        );
      })}
      <div className="h-px bg-slate-200 dark:bg-slate-700 my-1" />
      <button
        onClick={() => {
          onToggle(false);
          onApplyCurrentSlide('auto' as any);
        }}
        className="w-full px-3 py-2 flex items-center gap-3 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-left"
      >
        <Sparkles className="w-4 h-4 text-slate-500 dark:text-slate-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {t('仅当前页智能匹配')}
          </p>
        </div>
      </button>
    </div>
  );
}

export function EditorToolbar({
  onBack,
  onOpenPresentation,
  hasUnsavedChanges,
  onSave,
  onExport,
  iconStyleMenuOpen,
  onToggleIconStyleMenu,
  iconStyleOptions,
  onApplyIconStyle,
  onApplyIconStyleToCurrentSlide,
  onUndo,
  canUndo,
  onRedo,
  canRedo,
  onUnbind,
  selectedElements,
  onBind,
  onInsertTable,
  onInsertImage,
  onInsertVideo,
  onPreview,
  onZoomIn,
  onZoomOut,
  onZoomChange,
  zoom,
  iconStyleMenuRef,
}: EditorToolbarProps) {
  return (
    <div className="h-14 bg-white border-b border-slate-200 flex items-center px-4 gap-3 shrink-0">
      <button
        onClick={onBack}
        className="p-2 hover:bg-slate-100 rounded-lg transition-colors shrink-0"
        title={t('返回')}
      >
        <ArrowLeft className="w-5 h-5 text-slate-600" />
      </button>
      <div className="w-px h-6 bg-slate-200" />
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={onOpenPresentation}
          className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          title={t('打开演示')}
        >
          <FolderOpen className="w-5 h-5 text-slate-600" />
        </button>
        <button
          onClick={onSave}
          disabled={!hasUnsavedChanges}
          className={`p-2 rounded-lg transition-all ${
            hasUnsavedChanges
              ? 'hover:bg-blue-50 text-blue-600 cursor-pointer'
              : 'text-slate-400 opacity-50 cursor-not-allowed'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
          title={t('保存 (Ctrl+S)')}
        >
          <Save className="w-5 h-5" />
        </button>
        <button
          onClick={onExport}
          className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          title={t('导出')}
        >
          <Download className="w-5 h-5 text-slate-600" />
        </button>
      </div>
      <div className="w-px h-6 bg-slate-200" />

      <div className="relative flex items-center" ref={iconStyleMenuRef}>
        <button
          onClick={() => onToggleIconStyleMenu(!iconStyleMenuOpen)}
          className="p-2 hover:bg-slate-100 rounded-lg transition-colors flex items-center gap-1"
          title={t('图标风格')}
        >
          <Hash className="w-5 h-5 text-slate-600" />
        </button>
        <IconStyleMenu
          open={iconStyleMenuOpen}
          onToggle={onToggleIconStyleMenu}
          options={iconStyleOptions}
          onApplyGlobal={onApplyIconStyle}
          onApplyCurrentSlide={onApplyIconStyleToCurrentSlide}
        />
      </div>

      <div className="w-px h-6 bg-slate-200" />

      <div className="flex-1" />

      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={onUndo}
          disabled={!canUndo}
          className="p-2 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-30"
          title={t('撤销 (Ctrl+Z)')}
        >
          <Undo2 className="w-5 h-5 text-slate-600" />
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          className="p-2 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-30"
          title={t('重做 (Ctrl+Y)')}
        >
          <Redo2 className="w-5 h-5 text-slate-600" />
        </button>
        <button
          onClick={onUnbind}
          disabled={
            selectedElements.length === 0 ||
            !selectedElements.some((el) => el.getAttribute('data-element-type') === 'group')
          }
          className="p-2 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-30"
          title={t('解绑 (Ctrl+Shift+G)')}
        >
          <UngroupIcon className="w-5 h-5 text-slate-600" />
        </button>
        <button
          onClick={onBind}
          disabled={selectedElements.length < 2}
          className="p-2 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-30"
          title={t('绑定 (Ctrl+G)')}
        >
          <GroupIcon className="w-5 h-5 text-slate-600" />
        </button>
        <div className="w-px h-6 bg-slate-200 mx-1" />
        <button
          onClick={onInsertTable}
          className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          title={t('插入表格')}
        >
          <Table className="w-5 h-5 text-slate-600" />
        </button>
        <button
          onClick={onInsertImage}
          className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          title={t('插入图片')}
        >
          <ImageIcon className="w-5 h-5 text-slate-600" />
        </button>
        <button
          onClick={onInsertVideo}
          className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          title={t('插入视频')}
        >
          <Video className="w-5 h-5 text-slate-600" />
        </button>
        <div className="w-px h-6 bg-slate-200 mx-1" />
        <button
          onClick={onPreview}
          className="inline-flex items-center gap-2 px-3 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors text-sm font-medium"
          title={t('演示')}
        >
          <Play className="w-4 h-4" />
          {t('演示')}
        </button>
        <div className="w-px h-6 bg-slate-200 mx-1" />
        <button
          onClick={onZoomOut}
          className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          title={t('缩小')}
        >
          <ZoomOut className="w-5 h-5 text-slate-600" />
        </button>
        <input
          type="range"
          min="0.25"
          max="2"
          step="0.05"
          value={zoom}
          onChange={(e) => onZoomChange(parseFloat(e.target.value))}
          onPointerDown={() => onZoomChange(zoom)}
          className="w-28 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
        />
        <button
          onClick={onZoomIn}
          className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          title={t('放大')}
        >
          <ZoomIn className="w-5 h-5 text-slate-600" />
        </button>
        <span className="text-sm text-slate-600 min-w-[56px] text-center">
          {Math.round(zoom * 100)}%
        </span>
      </div>
    </div>
  );
}
