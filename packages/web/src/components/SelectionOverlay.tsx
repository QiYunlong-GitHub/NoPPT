import { useEffect, useState, useRef } from 'react';
import type { ResizeDirection } from '@/utils/Resizer';

export interface SelectionBoxRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SelectionOverlayProps {
  selectedElements: HTMLElement[];
  zoom: number;
  slideContainerRef: React.RefObject<HTMLDivElement | null>;
  resizeBox: SelectionBoxRect | null;
  isTextEditing: boolean;
}

const HANDLE_SIZE = 12;
const HANDLE_OFFSET = HANDLE_SIZE / 2;

const HANDLES: { direction: ResizeDirection; cursor: string; getPosition: (box: SelectionBoxRect) => { left: number; top: number } }[] = [
  {
    direction: 'nw',
    cursor: 'nw-resize',
    getPosition: (box) => ({ left: box.x - HANDLE_OFFSET, top: box.y - HANDLE_OFFSET }),
  },
  {
    direction: 'n',
    cursor: 'n-resize',
    getPosition: (box) => ({ left: box.x + box.width / 2 - HANDLE_OFFSET, top: box.y - HANDLE_OFFSET }),
  },
  {
    direction: 'ne',
    cursor: 'ne-resize',
    getPosition: (box) => ({ left: box.x + box.width - HANDLE_OFFSET, top: box.y - HANDLE_OFFSET }),
  },
  {
    direction: 'e',
    cursor: 'e-resize',
    getPosition: (box) => ({ left: box.x + box.width - HANDLE_OFFSET, top: box.y + box.height / 2 - HANDLE_OFFSET }),
  },
  {
    direction: 'se',
    cursor: 'se-resize',
    getPosition: (box) => ({ left: box.x + box.width - HANDLE_OFFSET, top: box.y + box.height - HANDLE_OFFSET }),
  },
  {
    direction: 's',
    cursor: 's-resize',
    getPosition: (box) => ({ left: box.x + box.width / 2 - HANDLE_OFFSET, top: box.y + box.height - HANDLE_OFFSET }),
  },
  {
    direction: 'sw',
    cursor: 'sw-resize',
    getPosition: (box) => ({ left: box.x - HANDLE_OFFSET, top: box.y + box.height - HANDLE_OFFSET }),
  },
  {
    direction: 'w',
    cursor: 'w-resize',
    getPosition: (box) => ({ left: box.x - HANDLE_OFFSET, top: box.y + box.height / 2 - HANDLE_OFFSET }),
  },
];

export function SelectionOverlay({
  selectedElements,
  zoom,
  slideContainerRef,
  resizeBox,
  isTextEditing,
}: SelectionOverlayProps) {
  const [box, setBox] = useState<SelectionBoxRect | null>(resizeBox);
  const observerRef = useRef<ResizeObserver | null>(null);

  const recompute = () => {
    const elements = selectedElements;
    if (!elements || elements.length === 0) {
      setBox(null);
      return;
    }

    const container = slideContainerRef.current;
    const innerDiv = container?.querySelector('[data-slide-content="true"]') as HTMLElement | null;
    if (!container || !innerDiv) {
      setBox(null);
      return;
    }

    const containerRect = innerDiv.getBoundingClientRect();
    const z = zoom || 1;

    let minLeft = Infinity;
    let minTop = Infinity;
    let maxRight = -Infinity;
    let maxBottom = -Infinity;

    elements.forEach((el) => {
      if (!el || !el.isConnected) return;
      const rect = el.getBoundingClientRect();
      const left = (rect.left - containerRect.left) / z;
      const top = (rect.top - containerRect.top) / z;
      const right = (rect.right - containerRect.left) / z;
      const bottom = (rect.bottom - containerRect.top) / z;
      minLeft = Math.min(minLeft, left);
      minTop = Math.min(minTop, top);
      maxRight = Math.max(maxRight, right);
      maxBottom = Math.max(maxBottom, bottom);
    });

    if (!isFinite(minLeft)) {
      setBox(null);
      return;
    }

    setBox({
      x: minLeft,
      y: minTop,
      width: maxRight - minLeft,
      height: maxBottom - minTop,
    });
  };

  useEffect(() => {
    recompute();

    const observer = new ResizeObserver(() => {
      recompute();
    });
    observerRef.current = observer;

    selectedElements.forEach((el) => {
      if (el && el.isConnected) {
        observer.observe(el);
      }
    });

    const handleScrollOrResize = () => recompute();
    window.addEventListener('resize', handleScrollOrResize);
    const scrollContainer = slideContainerRef.current?.closest('.overflow-auto');
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', handleScrollOrResize);
    }

    return () => {
      observer.disconnect();
      observerRef.current = null;
      window.removeEventListener('resize', handleScrollOrResize);
      if (scrollContainer) {
        scrollContainer.removeEventListener('scroll', handleScrollOrResize);
      }
    };
  }, [selectedElements, zoom, slideContainerRef]);

  useEffect(() => {
    if (resizeBox) {
      setBox(resizeBox);
    }
  }, [resizeBox]);

  if (!box || selectedElements.length === 0 || isTextEditing) {
    return null;
  }

  const showHandles = selectedElements.length === 1;

  return (
    <>
      <div
        className="absolute pointer-events-none border border-blue-500"
        style={{
          left: `${box.x}px`,
          top: `${box.y}px`,
          width: `${box.width}px`,
          height: `${box.height}px`,
          zIndex: 9998,
        }}
      />
      {showHandles &&
        HANDLES.map(({ direction, cursor, getPosition }) => {
          const pos = getPosition(box);
          return (
            <div
              key={direction}
              data-resize-handle={direction}
              className="absolute w-3 h-3 bg-white border-2 border-blue-500 rounded-full pointer-events-auto"
              style={{
                left: `${pos.left}px`,
                top: `${pos.top}px`,
                zIndex: 9999,
                cursor,
              }}
            />
          );
        })}
    </>
  );
}
