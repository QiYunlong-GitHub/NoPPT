/**
 * 演讲者备注 —— 借鉴 python-pptx 的 `notes_slide` / `notes_master`。
 *
 * NoPPT 的 `Slide.notes` 字段早已存在但一直没打通到任何产物，
 * 这里把它写进 PPTX 的备注页（PowerPoint「备注」窗格 / 演讲者视图可见）。
 */

/** 备注上限：OOXML 无硬限制，但过长的文本会让 PowerPoint 卡顿，取一个保守值。 */
export const MAX_NOTE_CHARS = 4000;

/**
 * 计算备注文本：优先用 slide.notes，其次用 deck slide 的 notes。
 * 返回 null 表示没有备注（不调用 addNotes，避免生成空备注页）。
 */
export function resolveSlideNotes(slideNotes?: string, deckNotes?: string): string | null {
  const raw = (slideNotes || deckNotes || '').trim();
  if (!raw) return null;
  return raw.length > MAX_NOTE_CHARS ? `${raw.slice(0, MAX_NOTE_CHARS - 1)}…` : raw;
}

/** 写入备注。 */
export function applySlideNotes(slide: { addNotes?: Function }, notes: string | null): void {
  if (!notes || typeof slide?.addNotes !== 'function') return;
  try {
    slide.addNotes(notes);
  } catch {
    // 备注失败不影响正文导出
  }
}
