import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePresentationStore } from '@/stores/presentation';
import {
  calculateViewportAdapter,
  logicalToViewportPoint,
  useZoom,
  viewportToLogicalPoint,
  type ViewportAdapter,
} from '../useZoom';

class ResizeObserverHarness {
  static instances: ResizeObserverHarness[] = [];
  callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    ResizeObserverHarness.instances.push(this);
  }

  observe() {}
  unobserve() {}
  disconnect() {}
  emit() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

describe('viewport adapter / useZoom', () => {
  beforeEach(() => {
    ResizeObserverHarness.instances = [];
    vi.stubGlobal('ResizeObserver', ResizeObserverHarness);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    usePresentationStore.setState({
      presentation: {
        id: 'viewport-test',
        title: 'Viewport test',
        slides: [],
        selectedSlideId: undefined,
        zoom: 1,
        width: 1280,
        height: 720,
        transition: 'none',
        createdAt: 0,
        updatedAt: 0,
        version: 1,
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    usePresentationStore.setState({ presentation: null });
  });

  it.each([
    [800, 600, 0.625, 'narrow'],
    [1280, 720, 1, 'standard'],
    [1600, 900, 1.25, 'wide'],
  ] as const)(
    'fits the logical canvas at %sx%s without padding bias',
    (width, height, scale, profile) => {
      const adapter = calculateViewportAdapter({
        logicalWidth: 1280,
        logicalHeight: 720,
        viewportWidth: width,
        viewportHeight: height,
      });

      expect(adapter).toMatchObject({
        logicalWidth: 1280,
        logicalHeight: 720,
        viewportWidth: width,
        viewportHeight: height,
        scale,
        profile,
      });
      expect(adapter.viewportCanvasWidth).toBeCloseTo(1280 * scale);
      expect(adapter.viewportCanvasHeight).toBeCloseTo(720 * scale);
    },
  );

  it('keeps a complete logical canvas through continuous narrow-to-wide resize', () => {
    const samples = [
      calculateViewportAdapter({
        logicalWidth: 1280,
        logicalHeight: 720,
        viewportWidth: 800,
        viewportHeight: 600,
      }),
      calculateViewportAdapter({
        logicalWidth: 1280,
        logicalHeight: 720,
        viewportWidth: 1024,
        viewportHeight: 650,
      }),
      calculateViewportAdapter({
        logicalWidth: 1280,
        logicalHeight: 720,
        viewportWidth: 1280,
        viewportHeight: 720,
      }),
      calculateViewportAdapter({
        logicalWidth: 1280,
        logicalHeight: 720,
        viewportWidth: 1600,
        viewportHeight: 900,
      }),
    ];

    expect(samples.map((sample) => sample.scale)).toEqual([0.625, 0.8, 1, 1.25]);
    expect(samples.map((sample) => sample.profile)).toEqual([
      'narrow',
      'standard',
      'standard',
      'wide',
    ]);
    samples.forEach((sample) => {
      expect(sample.viewportCanvasWidth).toBeLessThanOrEqual(sample.viewportWidth);
      expect(sample.viewportCanvasHeight).toBeLessThanOrEqual(sample.viewportHeight);
    });
  });

  it('round-trips pointer coordinates between viewport and logical canvas', () => {
    const adapter: ViewportAdapter = calculateViewportAdapter({
      logicalWidth: 1280,
      logicalHeight: 720,
      viewportWidth: 800,
      viewportHeight: 600,
    });
    const logicalPoint = { x: 640, y: 360 };
    const viewportPoint = logicalToViewportPoint(logicalPoint, adapter, { x: 24, y: 18 });

    expect(viewportPoint).toEqual({ x: 424, y: 243 });
    expect(viewportToLogicalPoint(viewportPoint, adapter, { x: 24, y: 18 })).toEqual(logicalPoint);
  });

  it('updates fit scale and profile from ResizeObserver while preserving user zoom override', () => {
    vi.useFakeTimers();
    const editorArea = document.createElement('div');
    Object.defineProperties(editorArea, {
      clientWidth: { configurable: true, value: 800, writable: true },
      clientHeight: { configurable: true, value: 600, writable: true },
    });
    const editorAreaRef = { current: editorArea };
    const setZoom = vi.fn();

    const { result } = renderHook(() =>
      useZoom({
        editorAreaRef,
        presentationId: 'viewport-test',
        presentationWidth: 1280,
        presentationHeight: 720,
        setZoom,
      }),
    );

    act(() => vi.runAllTimers());
    expect(setZoom).toHaveBeenLastCalledWith(0.625);
    expect(result.current.viewport).toMatchObject({ scale: 0.625, profile: 'narrow' });

    Object.defineProperty(editorArea, 'clientWidth', { configurable: true, value: 1600 });
    Object.defineProperty(editorArea, 'clientHeight', { configurable: true, value: 900 });
    act(() => ResizeObserverHarness.instances[0].emit());
    expect(setZoom).toHaveBeenLastCalledWith(1.25);
    expect(result.current.viewport).toMatchObject({ scale: 1.25, profile: 'wide' });

    act(() => result.current.setUserZoomOverride(true));
    Object.defineProperty(editorArea, 'clientWidth', { configurable: true, value: 800 });
    act(() => ResizeObserverHarness.instances[0].emit());
    expect(setZoom).toHaveBeenLastCalledWith(1.25);
  });
});
