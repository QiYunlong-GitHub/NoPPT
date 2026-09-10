import { useEffect, useRef } from 'react';
import { usePresentationStore } from '@/stores/presentation';

interface UseZoomParams {
  editorAreaRef: React.RefObject<HTMLDivElement | null>;
  presentationId?: string;
  presentationWidth?: number;
  presentationHeight?: number;
  setZoom: (zoom: number) => void;
}

export function useZoom({
  editorAreaRef,
  presentationId,
  presentationWidth,
  presentationHeight,
  setZoom,
}: UseZoomParams) {
  const userZoomOverrideRef = useRef(false);
  const weAdjustedZoomInSessionRef = useRef(false);

  const fitZoomToContainer = (force = false): boolean => {
    const presentation = usePresentationStore.getState().presentation;
    if (!presentation) return false;
    const editorArea = editorAreaRef.current;
    if (!editorArea) return false;

    if (userZoomOverrideRef.current) return false;
    if (!force && presentation.zoom !== 1) return false;
    if (force && !weAdjustedZoomInSessionRef.current) return false;

    const slideWidth = presentationWidth || 1280;
    const slideHeight = presentationHeight || 720;

    const padding = 32 * 2;
    const availableWidth = editorArea.clientWidth - padding;
    const availableHeight = editorArea.clientHeight - padding;

    if (availableWidth <= 0 || availableHeight <= 0) return false;

    const scaleX = availableWidth / slideWidth;
    const scaleY = availableHeight / slideHeight;
    let idealZoom = Math.min(scaleX, scaleY) * 0.95;
    idealZoom = Math.max(0.25, Math.min(2, idealZoom));

    setZoom(idealZoom);
    weAdjustedZoomInSessionRef.current = true;
    return true;
  };

  useEffect(() => {
    userZoomOverrideRef.current = false;
    weAdjustedZoomInSessionRef.current = false;
  }, [presentationId]);

  useEffect(() => {
    const presentation = usePresentationStore.getState().presentation;
    if (!presentation) return;

    const timers: ReturnType<typeof setTimeout>[] = [];
    const tryFitAt = (delay: number) => {
      const t = setTimeout(() => {
        fitZoomToContainer(false);
      }, delay);
      timers.push(t);
    };

    [30, 80, 200, 500, 1000, 1800, 3000].forEach(tryFitAt);

    return () => {
      timers.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presentationId, presentationWidth, presentationHeight]);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    let cancelled = false;
    let ro: ResizeObserver | null = null;
    let rafId: number | null = null;

    const tryObserve = () => {
      if (cancelled) return;
      const editorArea = editorAreaRef.current;
      if (!editorArea) {
        rafId = requestAnimationFrame(tryObserve);
        return;
      }
      ro = new ResizeObserver(() => {
        if (userZoomOverrideRef.current) return;
        const currentZoom = usePresentationStore.getState().presentation?.zoom;
        if (currentZoom === 1) {
          fitZoomToContainer(false);
        } else {
          fitZoomToContainer(true);
        }
      });
      ro.observe(editorArea);
    };

    tryObserve();
    return () => {
      cancelled = true;
      if (rafId != null) cancelAnimationFrame(rafId);
      if (ro) ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presentationId]);

  useEffect(() => {
    const handleResize = () => {
      if (userZoomOverrideRef.current) return;
      const currentZoom = usePresentationStore.getState().presentation?.zoom;
      if (currentZoom === 1) {
        fitZoomToContainer(false);
      } else {
        fitZoomToContainer(true);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    fitZoomToContainer,
    userZoomOverrideRef,
  };
}
