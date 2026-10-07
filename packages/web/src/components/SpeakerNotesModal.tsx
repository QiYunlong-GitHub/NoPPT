/**
 * 演讲者备注 + 演示元信息编辑。
 *
 * 借鉴 python-pptx 的 `notes_slide` / `core_properties`：
 * - 每页备注写进 `Slide.notes` → 导出 PPTX 时落到备注页；
 * - deck 级作者 / 主题 / 版本 / 关键词写进 `Presentation.meta` → PPTX `docProps/core.xml`。
 *
 * 这两个字段此前在 NoPPT 里都存在（notes 字段早已定义）但从未打通到任何产物。
 */

import { useState } from 'react';
import { X, StickyNote, Info } from 'lucide-react';
import { usePresentationStore } from '@/stores/presentation';
import { useI18n } from '@/i18n';
import type { DeckMeta } from '@noppt/core/deck';

const MAX_NOTE = 4000;

export default function SpeakerNotesModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const presentation = usePresentationStore((s) => s.presentation);
  const selectedSlideId = usePresentationStore((s) => s.presentation?.selectedSlideId);
  const updateSlide = usePresentationStore((s) => s.updateSlide);
  const updatePresentation = usePresentationStore((s) => s.updatePresentation);

  const slide =
    presentation?.slides.find((s) => s.id === selectedSlideId) ?? presentation?.slides[0] ?? null;

  const meta: DeckMeta = presentation?.meta ?? {};
  const [author, setAuthor] = useState(meta.author ?? presentation?.author ?? '');
  const [subject, setSubject] = useState(meta.subject ?? presentation?.description ?? '');
  const [revision, setRevision] = useState(meta.revision ?? String(presentation?.version ?? ''));
  const [keywords, setKeywords] = useState(meta.keywords ?? presentation?.tags?.join('; ') ?? '');
  const [notes, setNotes] = useState(slide?.notes ?? '');
  const [saved, setSaved] = useState(false);

  const persistMeta = () => {
    updatePresentation({
      meta: {
        ...meta,
        title: presentation?.title,
        author: author || undefined,
        subject: subject || undefined,
        revision: revision || undefined,
        keywords: keywords || undefined,
      },
      // 同步到 Presentation 既有字段，避免两处不一致
      author: author || presentation?.author,
      description: subject || presentation?.description,
      tags: keywords
        ? keywords
            .split(/[;；,]/)
            .map((k) => k.trim())
            .filter(Boolean)
        : presentation?.tags,
    });
  };

  const handleSave = () => {
    if (slide) updateSlide(slide.id, { notes }, false);
    persistMeta();
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };

  if (!presentation || !slide) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center">
              <StickyNote className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">{t('演讲者备注')}</h3>
              <p className="text-xs text-slate-500">
                {t('第 {n} 页 · {title}', {
                  n: (slide.index ?? 0) + 1,
                  title: slide.title || t('未命名页'),
                })}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              {t('本页备注')}
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, MAX_NOTE))}
              rows={7}
              placeholder={t('写下这一页要讲的要点，导出 PPTX 后会在备注窗格与演讲者视图中显示。')}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-200 resize-none"
            />
            <p className="text-xs text-slate-400 mt-1">
              {notes.length} / {MAX_NOTE}
            </p>
          </div>

          <div className="border-t border-slate-100 pt-4">
            <div className="flex items-center gap-2 mb-3">
              <Info className="w-4 h-4 text-slate-400" />
              <span className="text-sm font-medium text-slate-700">{t('演示元信息')}</span>
              <span className="text-xs text-slate-400">{t('写入 PPTX 文件属性')}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">{t('作者')}</label>
                <input
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-200"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">{t('版本')}</label>
                <input
                  value={revision}
                  onChange={(e) => setRevision(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-200"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-slate-500 mb-1">{t('主题')}</label>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-200"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-slate-500 mb-1">{t('关键词')}</label>
                <input
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  placeholder={t('用分号分隔')}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-200"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
          {saved && <span className="text-sm text-green-600 mr-auto">{t('已保存')}</span>}
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            {t('关闭')}
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            {t('保存')}
          </button>
        </div>
      </div>
    </div>
  );
}
