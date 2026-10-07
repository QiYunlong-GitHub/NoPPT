import { useCallback, useEffect, useRef, useState } from 'react';
import { usePresentationStore } from '@/stores/presentation';

export const LOGICAL_CANVAS_WIDTH = 1280;
export const LOGICAL_CANVAS_HEIGHT = 720;

export type ViewportProfile = 'narrow' | 'standard' | 'wide';

export interface ViewportAdapter {
  logicalWidth: number;
  logicalHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  scale: number;
  profile: ViewportProfile;
  viewportCanvasWidth: number;
  viewportCanvasHeight: number;
}

export interface ViewportPoint {
  x: number;
  y: number;
}

interface ViewportDimensions {
  logicalWidth: number;
  logicalHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}

interface UseZoomParams {
  editorAreaRef: React.RefObject<HTMLDivElement | null>;
  presentationId?: string;
  presentationWidth?: number;
  presentationHeight?: number;
  setZoom: (zoom: number) => void;
}

const positiveOr = (value: number | undefined, fallback: number): number =>
  Number.isFinite(value) && (value as number) > 0 ? (value as number) : fallback;

export function getViewportProfile(viewportWidth: number, logicalWidth: number): ViewportProfile {
  const ratio = viewportWidth / positiveOr(logicalWidth, LOGICAL_CANVAS_WIDTH);
  if (ratio < 0.75) return 'narrow';
  if (ratio >= 1.25) return 'wide';
  return 'standard';
}

export function calculateViewportAdapter({
  logicalWidth,
  logicalHeight,
  viewportWidth,
  viewportHeight,
}: ViewportDimensions): ViewportAdapter {
  const safeLogicalWidth = positiveOr(logicalWidth, LOGICAL_CANVAS_WIDTH);
  const safeLogicalHeight = positiveOr(logicalHeight, LOGICAL_CANVAS_HEIGHT);
  const safeViewportWidth = positiveOr(viewportWidth, safeLogicalWidth);
  const safeViewportHeight = positiveOr(viewportHeight, safeLogicalHeight);
  const scale = Math.min(
    safeViewportWidth / safeLogicalWidth,
    safeViewportHeight / safeLogicalHeight,
  );

  return {
    logicalWidth: safeLogicalWidth,
    logicalHeight: safeLogicalHeight,
    viewportWidth: safeViewportWidth,
    viewportHeight: safeViewportHeight,
    scale,
    profile: getViewportProfile(safeViewportWidth, safeLogicalWidth),
    viewportCanvasWidth: safeLogicalWidth * scale,
    viewportCanvasHeight: safeLogicalHeight * scale,
  };
}

export function logicalToViewportPoint(
  point: ViewportPoint,
  adapter: Pick<ViewportAdapter, 'scale'>,
  origin: ViewportPoint = { x: 0, y: 0 },
): ViewportPoint {
  return {
    x: origin.x + point.x * adapter.scale,
    y: origin.y + point.y * adapter.scale,
  };
}

export function viewportToLogicalPoint(
  point: ViewportPoint,
  adapter: Pick<ViewportAdapter, 'scale'>,
  origin: ViewportPoint = { x: 0, y: 0 },
): ViewportPoint {
  const scale = positiveOr(adapter.scale, 1);
  return {
    x: (point.x - origin.x) / scale,
    y: (point.y - origin.y) / scale,
  };
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
  const [viewport, setViewport] = useState<ViewportAdapter>(() =>
    calculateViewportAdapter({
      logicalWidth: positiveOr(presentationWidth, LOGICAL_CANVAS_WIDTH),
      logicalHeight: positiveOr(presentationHeight, LOGICAL_CANVAS_HEIGHT),
      viewportWidth: positiveOr(presentationWidth, LOGICAL_CANVAS_WIDTH),
      viewportHeight: positiveOr(presentationHeight, LOGICAL_CANVAS_HEIGHT),
    }),
  );

  const readViewport = useCallback(() => {
    const logicalWidth = positiveOr(presentationWidth, LOGICAL_CANVAS_WIDTH);
    const logicalHeight = positiveOr(presentationHeight, LOGICAL_CANVAS_HEIGHT);
    const editorArea = editorAreaRef.current;

    return calculateViewportAdapter({
      logicalWidth,
      logicalHeight,
      viewportWidth: editorArea?.clientWidth || logicalWidth,
      viewportHeight: editorArea?.clientHeight || logicalHeight,
    });
  }, [editorAreaRef, presentationHeight, presentationWidth]);

  const fitZoomToContainer = useCallback(
    (force = false): boolean => {
      const presentation = usePresentationStore.getState().presentation;
      if (!presentation) return false;

      const nextViewport = readViewport();
      const currentZoom = positiveOr(presentation.zoom, 1);

      if (userZoomOverrideRef.current) {
        setViewport({
          ...nextViewport,
          scale: currentZoom,
          viewportCanvasWidth: nextViewport.logicalWidth * currentZoom,
          viewportCanvasHeight: nextViewport.logicalHeight * currentZoom,
        });
        return false;
      }

      if (!force && presentation.zoom !== 1 && !weAdjustedZoomInSessionRef.current) {
        setViewport({
          ...nextViewport,
          scale: currentZoom,
          viewportCanvasWidth: nextViewport.logicalWidth * currentZoom,
          viewportCanvasHeight: nextViewport.logicalHeight * currentZoom,
        });
        return false;
      }

      setViewport(nextViewport);
      setZoom(nextViewport.scale);
      weAdjustedZoomInSessionRef.current = true;
      return true;
    },
    [readViewport, setZoom],
  );

  const refreshViewport = useCallback(() => {
    const presentation = usePresentationStore.getState().presentation;
    if (!presentation) return;
    if (userZoomOverrideRef.current) {
      fitZoomToContainer(true);
      return;
    }

    fitZoomToContainer(presentation.zoom !== 1 || weAdjustedZoomInSessionRef.current);
  }, [fitZoomToContainer]);

  const setUserZoomOverride = useCallback((overridden: boolean) => {
    userZoomOverrideRef.current = overridden;
  }, []);

  useEffect(() => {
    userZoomOverrideRef.current = false;
    weAdjustedZoomInSessionRef.current = false;
  }, [presentationId]);

  useEffect(() => {
    const presentation = usePresentationStore.getState().presentation;
    if (!presentation) return;

    const timers: ReturnType<typeof setTimeout>[] = [];
    const tryFitAt = (delay: number) => {
      const timer = setTimeout(() => {
        fitZoomToContainer(false);
      }, delay);
      timers.push(timer);
    };

    [30, 80, 200, 500, 1000, 1800, 3000].forEach(tryFitAt);

    return () => {
      timers.forEach(clearTimeout);
    };
  }, [fitZoomToContainer, presentationId]);

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
        refreshViewport();
      });
      ro.observe(editorArea);
      refreshViewport();
    };

    tryObserve();
    return () => {
      cancelled = true;
      if (rafId != null) cancelAnimationFrame(rafId);
      if (ro) ro.disconnect();
    };
  }, [editorAreaRef, presentationId, refreshViewport]);

  useEffect(() => {
    const handleResize = () => refreshViewport();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [refreshViewport]);

  return {
    fitZoomToContainer,
    refreshViewport,
    setUserZoomOverride,
    userZoomOverrideRef,
    viewport,
  };
}
