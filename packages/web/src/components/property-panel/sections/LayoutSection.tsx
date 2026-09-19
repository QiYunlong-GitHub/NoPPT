import { t } from '@/i18n';
import {
  AlignHorizontalJustifyCenter,
  AlignVerticalJustifyCenter,
  MoveUp,
  MoveDown,
  MoveLeft,
  MoveRight,
  ArrowUpToLine,
  ArrowUp,
  ArrowDown,
  ArrowDownToLine,
  Copy,
  Paintbrush,
  X,
  Trash2,
} from 'lucide-react';
import type { PropertyPanelSharedProps } from './types';

// 布局/层级区块：位置（X/Y）、页面居中、位置微调、图层调整与复制/格式刷、删除。
// 原 PropertyPanel 尾部「位置 / 页面居中 / 位置微调 / 图层调整 / 删除」五段连续 JSX 整块迁移。
export function LayoutSection(props: PropertyPanelSharedProps) {
  const {
    isMultiSelect,
    elementType,
    allTextElements,
    position,
    selectedElements,
    isTextEditing,
    updaters,
    onAlign,
    onAlignSingle,
    onCopy,
    onBringToFront,
    onBringForward,
    onSendBackward,
    onSendToBack,
    onCancelPaste,
    isPasteMode,
    onFormatBrush,
    isFormatBrushMode,
    onDelete,
  } = props;

  return (
    <>
      {!isTextEditing && selectedElements.length > 0 && (
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-2">{t('位置')}</label>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 w-8">X</span>
              <input
                type="number"
                value={Math.round(position.left)}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (!isNaN(val)) {
                    updaters.updatePositionX(val);
                  }
                }}
                onBlur={updaters.handlePositionXBlur}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                className="flex-1 px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <span className="text-xs text-slate-400 w-6">px</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 w-8">Y</span>
              <input
                type="number"
                value={Math.round(position.top)}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (!isNaN(val)) {
                    updaters.updatePositionY(val);
                  }
                }}
                onBlur={updaters.handlePositionYBlur}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                className="flex-1 px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <span className="text-xs text-slate-400 w-6">px</span>
            </div>
          </div>
        </div>
      )}

      {!isTextEditing && selectedElements.length > 0 && (
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-2">{t('页面居中')}</label>
          <div className="grid grid-cols-2 gap-1">
            <button
              onClick={() =>
                isMultiSelect ? onAlign?.('center-slide-h') : onAlignSingle?.('center-slide-h')
              }
              className="p-2 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
              title={t('页面水平居中')}
            >
              <AlignHorizontalJustifyCenter className="w-4 h-4 text-blue-600 mx-auto" />
              <span className="text-xs text-blue-600 font-medium block mt-1">
                {t('水平居中')}
              </span>
            </button>
            <button
              onClick={() =>
                isMultiSelect ? onAlign?.('center-slide-v') : onAlignSingle?.('center-slide-v')
              }
              className="p-2 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
              title={t('页面垂直居中')}
            >
              <AlignVerticalJustifyCenter className="w-4 h-4 text-blue-600 mx-auto" />
              <span className="text-xs text-blue-600 font-medium block mt-1">
                {t('垂直居中')}
              </span>
            </button>
          </div>
        </div>
      )}

      {!isTextEditing && selectedElements.length > 0 && (
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-2">
            {t('位置微调')}
            {isMultiSelect && (
              <span className="text-slate-400 font-normal ml-1">{t('（批量移动）')}</span>
            )}
          </label>
          <div className="grid grid-cols-3 gap-1">
            <div></div>
            <button
              onClick={() => updaters.adjustPosition('up', 5)}
              className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >
              <MoveUp className="w-4 h-4 text-slate-600 mx-auto" />
            </button>
            <div></div>
            <button
              onClick={() => updaters.adjustPosition('left', 5)}
              className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >
              <MoveLeft className="w-4 h-4 text-slate-600 mx-auto" />
            </button>
            <div className="p-2 bg-slate-50 rounded-lg flex items-center justify-center">
              <span className="text-xs text-slate-400">{t('移动')}</span>
            </div>
            <button
              onClick={() => updaters.adjustPosition('right', 5)}
              className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >
              <MoveRight className="w-4 h-4 text-slate-600 mx-auto" />
            </button>
            <div></div>
            <button
              onClick={() => updaters.adjustPosition('down', 5)}
              className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >
              <MoveDown className="w-4 h-4 text-slate-600 mx-auto" />
            </button>
            <div></div>
          </div>
        </div>
      )}

      {!isTextEditing && onCopy && selectedElements.length > 0 && (
        <div className="pt-4 border-t border-slate-200">
          <label className="block text-xs font-medium text-slate-600 mb-2">{t('图层调整')}</label>
          <div className="grid grid-cols-4 gap-1 mb-3">
            <button
              onClick={onBringToFront}
              className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              title={t('置于顶层')}
            >
              <ArrowUpToLine className="w-4 h-4 text-slate-600 mx-auto" />
            </button>
            <button
              onClick={onBringForward}
              className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              title={t('上移一层')}
            >
              <ArrowUp className="w-4 h-4 text-slate-600 mx-auto" />
            </button>
            <button
              onClick={onSendBackward}
              className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              title={t('下移一层')}
            >
              <ArrowDown className="w-4 h-4 text-slate-600 mx-auto" />
            </button>
            <button
              onClick={onSendToBack}
              className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              title={t('置于底层')}
            >
              <ArrowDownToLine className="w-4 h-4 text-slate-600 mx-auto" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {isPasteMode ? (
              <button
                onClick={onCancelPaste}
                className="flex items-center justify-center gap-2 py-2.5 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-lg transition-colors text-sm font-medium col-span-2"
              >
                <X className="w-4 h-4" />
                {t('取消粘贴')}
              </button>
            ) : (
              <>
                <button
                  onClick={onCopy}
                  className="flex items-center justify-center gap-2 py-2.5 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg transition-colors text-sm font-medium"
                >
                  <Copy className="w-4 h-4" />
                  {t('复制')}
                </button>
                {(elementType === 'text' || allTextElements) && onFormatBrush && (
                  <button
                    onClick={onFormatBrush}
                    className={`flex items-center justify-center gap-2 py-2.5 rounded-lg transition-colors text-sm font-medium ${
                      isFormatBrushMode
                        ? 'bg-purple-600 text-white'
                        : 'bg-purple-50 text-purple-600 hover:bg-purple-100'
                    }`}
                  >
                    <Paintbrush className="w-4 h-4" />
                    {t('格式刷')}
                  </button>
                )}
              </>
            )}
          </div>
          {isPasteMode && (
            <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-700 text-center">
              {t('点击幻灯片上的位置进行粘贴，按 ESC 取消')}
            </div>
          )}
          {isFormatBrushMode && (
            <div className="mt-3 p-3 bg-purple-50 border border-purple-200 rounded-lg text-xs text-purple-700 text-center">
              {t('点击目标文字元素应用格式')}
            </div>
          )}
        </div>
      )}

      {!isTextEditing && selectedElements.length > 0 && (
        <div className="pt-4 border-t border-slate-200">
          <button
            onClick={onDelete}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg transition-colors text-sm font-medium"
          >
            <Trash2 className="w-4 h-4" />
            {isMultiSelect ? t('删除选中元素') : t('删除元素')}
          </button>
        </div>
      )}
    </>
  );
}
