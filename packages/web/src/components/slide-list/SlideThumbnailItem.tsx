import { GripVertical, Copy, Trash2 } from 'lucide-react';
import { cn } from '@/utils/cn';
import { safeHtml } from '@/utils';
import { t } from '@/i18n';
import type { Slide } from '@noppt/core';

export interface SlideThumbnailItemProps {
  slide: Slide;
  index: number;
  isSelected: boolean;
  isDragged: boolean;
  dragOverPosition: 'before' | 'after' | null;
  isEditing: boolean;
  editTitle: string;
  slideWidth: number;
  slideHeight: number;
  thumbnailScale: number;
  /** 首项用于测量缩略图缩放，其余传 null */
  measureRef?: React.Ref<HTMLDivElement> | null;
  /** 幻灯片总数大于 1 时才允许删除 */
  canRemove: boolean;
  onSlideClick: (e: React.MouseEvent, id: string, index: number) => void;
  onContextMenu: (e: React.MouseEvent, id: string, index: number) => void;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDragOver: (e: React.DragEvent, id: string) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, id: string) => void;
  onDragEnd: () => void;
  onEditTitleChange: (value: string) => void;
  onSaveRename: () => void;
  onCancelEdit: () => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
}

/** 单张幻灯片缩略图（从 SlideListPanel 的列表 map 中下沉，props 仅接值 + 回调） */
export function SlideThumbnailItem({
  slide,
  index,
  isSelected,
  isDragged,
  dragOverPosition,
  isEditing,
  editTitle,
  slideWidth,
  slideHeight,
  thumbnailScale,
  measureRef,
  canRemove,
  onSlideClick,
  onContextMenu,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  onEditTitleChange,
  onSaveRename,
  onCancelEdit,
  onDuplicate,
  onRemove,
}: SlideThumbnailItemProps) {
  return (
    <div
      className={cn(
        'group relative rounded-lg overflow-hidden cursor-pointer border-2 transition-all',
        isSelected
          ? 'border-blue-500 shadow-sm bg-blue-50/30'
          : 'border-transparent hover:border-slate-300',
        isDragged && 'opacity-50',
        dragOverPosition === 'before' && 'border-t-2 border-t-blue-500',
        dragOverPosition === 'after' && 'border-b-2 border-b-blue-500',
      )}
      onClick={(e) => onSlideClick(e, slide.id, index)}
      onContextMenu={(e) => onContextMenu(e, slide.id, index)}
      draggable={!isEditing}
      onDragStart={(e) => onDragStart(e, slide.id)}
      onDragOver={(e) => onDragOver(e, slide.id)}
      onDragLeave={onDragLeave}
      onDrop={(e) => onDrop(e, slide.id)}
      onDragEnd={onDragEnd}
    >
      <div className="absolute left-1 top-1/2 -translate-y-1/2 z-10 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab">
        <GripVertical className="w-3 h-3 text-slate-400" />
      </div>

      <div className="absolute left-0 top-0 h-full w-5 bg-gradient-to-r from-black/5 to-transparent flex items-start justify-center pt-2">
        <span className="text-[10px] font-medium text-slate-500">{index + 1}</span>
      </div>

      <div
        ref={measureRef}
        className="ml-5 w-full overflow-hidden bg-white"
        style={{ aspectRatio: `${slideWidth} / ${slideHeight}` }}
      >
        <div
          className="origin-top-left bg-white relative"
          style={{
            width: `${slideWidth}px`,
            height: `${slideHeight}px`,
            transform: `scale(${thumbnailScale})`,
            transformOrigin: 'top left',
          }}
          dangerouslySetInnerHTML={safeHtml(slide.html)}
        />
      </div>

      <div className="absolute right-1 top-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDuplicate(slide.id);
          }}
          className="p-1 bg-white/90 rounded hover:bg-slate-100"
          title={t('复制')}
        >
          <Copy className="w-3 h-3 text-slate-500" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (canRemove) {
              onRemove(slide.id);
            }
          }}
          className="p-1 bg-white/90 rounded hover:bg-red-50"
          title={t('删除')}
          disabled={!canRemove}
        >
          <Trash2 className="w-3 h-3 text-red-500" />
        </button>
      </div>

      <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[10px] px-2 py-1 truncate">
        {isEditing ? (
          <input
            value={editTitle}
            onChange={(e) => onEditTitleChange(e.target.value)}
            onBlur={onSaveRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSaveRename();
              if (e.key === 'Escape') onCancelEdit();
            }}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            className="w-full bg-white/20 border border-white/40 rounded px-1 py-0.5 text-white text-[10px] outline-none"
          />
        ) : (
          slide.title
        )}
      </div>
    </div>
  );
}
