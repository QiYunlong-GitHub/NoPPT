import { t } from '@/i18n';
import { Plus, Star, X } from 'lucide-react';
import type { AIModelSettingsStore, AIModelHandlers } from './types';

type ImageModel = NonNullable<AIModelHandlers['activeImageProvider']>['models'][number];

function ImageModelSizes({
  imgModel,
  modelIndex,
  handlers,
}: {
  imgModel: ImageModel;
  modelIndex: number;
  handlers: AIModelHandlers;
}) {
  const { addImageSize, removeImageSize, updateImageSize } = handlers;
  return (
    <div className="pl-0 border-l-2 border-slate-200 dark:border-slate-700 ml-2">
      <div className="flex items-center justify-between mb-2 ml-3">
        <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
          {t('可用图片尺寸')}
        </span>
        <button
          onClick={() => addImageSize(modelIndex)}
          className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 rounded transition-colors"
        >
          <Plus className="w-3 h-3" />
          {t('添加尺寸')}
        </button>
      </div>
      <p className="text-[11px] text-slate-500 dark:text-slate-500 mb-2 ml-3">
        {t('每个尺寸配置宽（长）和高（宽），默认使用第一个尺寸')}
      </p>
      <div className="space-y-2 ml-3">
        {(imgModel.sizes || []).map((size, sizeIndex) => (
          <div key={sizeIndex} className="flex items-center gap-2">
            <span className="text-[11px] text-slate-400 w-8">{sizeIndex + 1}.</span>
            {sizeIndex === 0 && (
              <span className="px-1 py-0.5 text-[9px] font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded shrink-0">
                {t('默认')}
              </span>
            )}
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={size.width}
                onChange={(e) =>
                  updateImageSize(modelIndex, sizeIndex, 'width', parseInt(e.target.value) || 0)
                }
                className="w-20 px-2 py-1 border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded text-sm"
                min="1"
              />
              <span className="text-slate-400">×</span>
              <input
                type="number"
                value={size.height}
                onChange={(e) =>
                  updateImageSize(modelIndex, sizeIndex, 'height', parseInt(e.target.value) || 0)
                }
                className="w-20 px-2 py-1 border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded text-sm"
                min="1"
              />
              <span className="text-xs text-slate-400 ml-1">
                {size.width}×{size.height}
              </span>
            </div>
            {(imgModel.sizes?.length || 0) > 1 && (
              <button
                onClick={() => removeImageSize(modelIndex, sizeIndex)}
                className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                title={t('删除此尺寸')}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ImageModelPixelRanges({
  imgModel,
  modelIndex,
  handlers,
}: {
  imgModel: ImageModel;
  modelIndex: number;
  handlers: AIModelHandlers;
}) {
  const { addPixelRange, removePixelRange, updatePixelRange } = handlers;
  return (
    <div className="pl-0 border-l-2 border-slate-200 dark:border-slate-700 ml-2 mt-3">
      <div className="flex items-center justify-between mb-2 ml-3">
        <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
          {t('总像素取值范围')}
          <span className="text-slate-400 font-normal">{t('（可选，最多1条）')}</span>
        </span>
        <button
          onClick={() => addPixelRange(modelIndex)}
          disabled={(imgModel.pixelRanges?.length || 0) >= 1}
          className={`flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded transition-colors ${
            (imgModel.pixelRanges?.length || 0) >= 1
              ? 'text-slate-400 dark:text-slate-600 bg-slate-100 dark:bg-slate-800 cursor-not-allowed'
              : 'text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20'
          }`}
        >
          <Plus className="w-3 h-3" />
          {t('添加范围')}
        </button>
      </div>
      <p className="text-[11px] text-slate-500 dark:text-slate-500 mb-2 ml-3">
        {t('用于路由功能自动选择合适尺寸，配置像素下限和上限')}
      </p>
      {imgModel.pixelRanges && imgModel.pixelRanges.length > 0 ? (
        <div className="space-y-2 ml-3">
          {imgModel.pixelRanges.map((range, rangeIndex) => (
            <div key={rangeIndex} className="flex items-center gap-2 flex-wrap">
              <input
                type="number"
                value={range.minPixels}
                onChange={(e) =>
                  updatePixelRange(
                    modelIndex,
                    rangeIndex,
                    'minPixels',
                    parseInt(e.target.value) || 0,
                  )
                }
                className="w-24 px-2 py-1 border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded text-sm"
                min="0"
                placeholder={t('下限')}
              />
              <span className="text-slate-400">~</span>
              <input
                type="number"
                value={range.maxPixels}
                onChange={(e) =>
                  updatePixelRange(
                    modelIndex,
                    rangeIndex,
                    'maxPixels',
                    parseInt(e.target.value) || 0,
                  )
                }
                className="w-24 px-2 py-1 border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded text-sm"
                min="0"
                placeholder={t('上限')}
              />
              <input
                type="text"
                value={range.label || ''}
                onChange={(e) => updatePixelRange(modelIndex, rangeIndex, 'label', e.target.value)}
                className="w-28 px-2 py-1 border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded text-sm"
                placeholder={t('标签（如高清）')}
              />
              <span className="text-[10px] text-slate-400">
                {Math.round((range.minPixels / 1024 / 1024) * 10) / 10}MP ~{' '}
                {Math.round((range.maxPixels / 1024 / 1024) * 10) / 10}MP
              </span>
              <button
                onClick={() => removePixelRange(modelIndex, rangeIndex)}
                className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                title={t('删除此范围')}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-slate-400 ml-3 italic">{t('未配置像素范围（可选配置）')}</p>
      )}
    </div>
  );
}

function ImageModelCard({
  imgModel,
  modelIndex,
  settings,
  activeImageProvider,
  handlers,
}: {
  imgModel: ImageModel;
  modelIndex: number;
  settings: AIModelSettingsStore;
  activeImageProvider: AIModelHandlers['activeImageProvider'];
  handlers: AIModelHandlers;
}) {
  const { updateImageModelName, setImageModelAsDefault, removeImageModel } = handlers;
  return (
    <div
      key={modelIndex}
      className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 bg-slate-50 dark:bg-slate-800/50"
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 w-14">
          {t('模型')}
          {modelIndex + 1}
        </span>
        {modelIndex === 0 ? (
          <span
            className="px-1.5 py-0.5 text-[10px] font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded flex items-center gap-0.5"
            title={t('当前默认模型')}
          >
            <Star className="w-3 h-3 fill-current" />
            {t('默认')}
          </span>
        ) : (
          <button
            onClick={() => setImageModelAsDefault(modelIndex)}
            className="p-1 text-slate-400 hover:text-yellow-500 hover:bg-yellow-50 dark:hover:bg-yellow-900/20 rounded transition-colors"
            title={t('设为默认模型（移动到第一位）')}
          >
            <Star className="w-4 h-4" />
          </button>
        )}
        <input
          type="text"
          value={imgModel.modelName}
          onChange={(e) => updateImageModelName(modelIndex, e.target.value)}
          placeholder={t('输入模型名称，例如：dall-e-3')}
          className="flex-1 px-2 py-1.5 border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded text-sm font-mono"
        />
        {(activeImageProvider?.models?.length || 0) > 1 && (
          <button
            onClick={() => removeImageModel(modelIndex)}
            className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
            title={t('删除此模型')}
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <ImageModelSizes imgModel={imgModel} modelIndex={modelIndex} handlers={handlers} />
      <ImageModelPixelRanges imgModel={imgModel} modelIndex={modelIndex} handlers={handlers} />
    </div>
  );
}

export function ImageModelList({
  settings,
  activeImageProvider,
  handlers,
}: {
  settings: AIModelSettingsStore;
  activeImageProvider: AIModelHandlers['activeImageProvider'];
  handlers: AIModelHandlers;
}) {
  const { addImageModel } = handlers;
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          {t('模型列表')}
        </label>
        <button
          onClick={addImageModel}
          className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          {t('添加模型')}
        </button>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
        {t(
          '支持配置多个模型，每个模型可独立配置尺寸列表和像素范围，默认使用第一个模型',
        )}
      </p>

      <div className="space-y-4">
        {(activeImageProvider?.models || []).map((imgModel, modelIndex) => (
          <ImageModelCard
            key={modelIndex}
            imgModel={imgModel}
            modelIndex={modelIndex}
            settings={settings}
            activeImageProvider={activeImageProvider}
            handlers={handlers}
          />
        ))}
        {(!activeImageProvider?.models || activeImageProvider.models.length === 0) && (
          <div className="text-center py-6 text-slate-400 dark:text-slate-500">
            <p className="text-sm">{t('暂无模型，请点击上方"添加模型"按钮')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
