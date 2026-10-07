import type { ChangeEvent, ReactNode, RefObject } from 'react';
import { t } from '@/i18n';

type ReferenceSlot = 'global' | 'cover' | 'content' | 'summary';
type ReferenceKind = 'html' | 'image';

interface ReferenceFilesSectionProps {
  renderReferenceRow: (slot: ReferenceSlot, kind: ReferenceKind) => ReactNode;
  renderCategoryCard: (slot: ReferenceSlot, title: string, subtitle: string) => ReactNode;
  handleReferenceFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  htmlInputRef: RefObject<HTMLInputElement>;
  imageInputRef: RefObject<HTMLInputElement>;
}

export function ReferenceFilesSection({
  renderReferenceRow,
  renderCategoryCard,
  handleReferenceFileChange,
  htmlInputRef,
  imageInputRef,
}: ReferenceFilesSectionProps) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
        {t('参考文件（可选）')}
      </label>

      <div className="mb-4">
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
          {t('全局共享参考：未单独上传分类参考时，作为所有页面的兜底来源')}
        </p>
        <div className="grid grid-cols-2 gap-3">
          {renderReferenceRow('global', 'html')}
          {renderReferenceRow('global', 'image')}
        </div>
      </div>

      <div className="space-y-3">
        {renderCategoryCard(
          'cover',
          t('封面参考（仅用于首页封面页）'),
          t('未上传则封面页不应用任何参考属性'),
        )}
        {renderCategoryCard(
          'content',
          t('内容参考（用于目录和正文内容页）'),
          t('未上传则目录/内容页不应用任何参考属性（目录页与正文页共用同一份内容参考）'),
        )}
        {renderCategoryCard(
          'summary',
          t('总结参考（仅用于结尾总结页）'),
          t('未上传则总结页不应用任何参考属性'),
        )}
      </div>

      <input
        ref={htmlInputRef}
        type="file"
        accept=".html,.htm"
        onChange={handleReferenceFileChange}
        className="hidden"
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        onChange={handleReferenceFileChange}
        className="hidden"
      />
    </div>
  );
}
