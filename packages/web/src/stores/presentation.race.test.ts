// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { Presentation } from '@noppt/core';
import { presentationApi, type ChatMessage } from '@/utils/api';
import { usePresentationStore } from './presentation';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const makePresentation = (id: string, title = id): Presentation =>
  ({
    id,
    title,
    slides: [{ id: `${id}-s1`, title: 'Slide', html: '<div>ok</div>', hidden: false, index: 0 }],
    zoom: 1,
    width: 1280,
    height: 720,
    transition: 'none',
    createdAt: 1,
    updatedAt: 1,
    version: 1,
  }) as Presentation;

describe('presentation async race guards', () => {
  it('does not let an older load replace a newer route load', async () => {
    const first = deferred<Presentation>();
    const second = deferred<Presentation>();
    const get = vi
      .spyOn(presentationApi, 'get')
      .mockImplementation((id) => Promise.resolve(id === 'first' ? first.promise : second.promise));
    const chat = vi.spyOn(presentationApi, 'getChatHistory').mockResolvedValue([]);
    usePresentationStore.setState({ presentation: null, error: null });

    const oldLoad = usePresentationStore.getState().loadPresentation('first');
    const newLoad = usePresentationStore.getState().loadPresentation('second');
    second.resolve(makePresentation('second', 'Newer'));
    await newLoad;
    first.resolve(makePresentation('first', 'Older'));
    await oldLoad;

    expect(usePresentationStore.getState().presentation?.id).toBe('second');
    expect(chat).toHaveBeenCalledWith('second');
    get.mockRestore();
    chat.mockRestore();
  });

  it('does not clear unsaved edits when a save response becomes stale', async () => {
    const save = deferred<Presentation>();
    const saveSpy = vi.spyOn(presentationApi, 'save').mockReturnValue(save.promise);
    const initial = makePresentation('p1', 'Initial');
    usePresentationStore.setState({ presentation: initial, hasUnsavedChanges: false });

    const pendingSave = usePresentationStore.getState().savePresentation();
    usePresentationStore.getState().updatePresentation({ title: 'Newer edit' });
    save.resolve(makePresentation('p1', 'Older server response'));
    await pendingSave;

    expect(usePresentationStore.getState().presentation?.title).toBe('Newer edit');
    expect(usePresentationStore.getState().hasUnsavedChanges).toBe(true);
    expect(saveSpy).toHaveBeenCalledOnce();
    saveSpy.mockRestore();
  });

  it('renders the canvas before chat history resolves, then patches messages in', async () => {
    const chat = deferred<ChatMessage[]>();
    const get = vi.spyOn(presentationApi, 'get').mockResolvedValue(makePresentation('p1'));
    const chatSpy = vi.spyOn(presentationApi, 'getChatHistory').mockReturnValue(chat.promise);
    usePresentationStore.setState({ presentation: null, error: null });

    await usePresentationStore.getState().loadPresentation('p1');
    expect(usePresentationStore.getState().presentation?.id).toBe('p1');
    expect(chatSpy).toHaveBeenCalledWith('p1');

    const late = [{ content: 'late-chat' }] as unknown as ChatMessage[];
    chat.resolve(late);
    await vi.waitFor(() => {
      expect(usePresentationStore.getState().chatMessages).toEqual(late);
    });
    get.mockRestore();
    chatSpy.mockRestore();
  });

  it('ignores stale chat history after switching to another presentation', async () => {
    const oldChat = deferred<ChatMessage[]>();
    const get = vi
      .spyOn(presentationApi, 'get')
      .mockImplementation((id) => Promise.resolve(makePresentation(id)));
    const chatSpy = vi
      .spyOn(presentationApi, 'getChatHistory')
      .mockImplementation((id) => (id === 'first' ? oldChat.promise : Promise.resolve([])));
    usePresentationStore.setState({ presentation: null, error: null });

    await usePresentationStore.getState().loadPresentation('first');
    await usePresentationStore.getState().loadPresentation('second');
    const stale = [{ content: 'stale-chat' }] as unknown as ChatMessage[];
    oldChat.resolve(stale);
    await Promise.resolve();
    await Promise.resolve();

    expect(usePresentationStore.getState().presentation?.id).toBe('second');
    expect(usePresentationStore.getState().chatMessages).not.toEqual(stale);
    get.mockRestore();
    chatSpy.mockRestore();
  });
});
