import { Dragger, type DragMoveContext, type DragEndContext } from './Dragger';

export type ResizeDirection = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

export interface ResizeRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ResizeStartState extends ResizeRect {
  direction: ResizeDirection;
  aspectRatio: number;
  minWidth?: number;
  minHeight?: number;
  keepAspectRatio: boolean;
}

export type ResizeResult = ResizeRect;

export class Resizer {
  private state: ResizeStartState;
  private _lastResult: ResizeResult;

  constructor(state: ResizeStartState) {
    this.state = state;
    this._lastResult = {
      left: state.left,
      top: state.top,
      width: state.width,
      height: state.height,
    };
  }

  get lastResult(): ResizeResult {
    return this._lastResult;
  }

  update(dx: number, dy: number): ResizeResult {
    const { left: startLeft, top: startTop, width: startWidth, height: startHeight, direction, keepAspectRatio, minWidth = 10, minHeight = 10 } = this.state;
    const aspectRatio = this.state.aspectRatio;

    let newLeft = startLeft;
    let newTop = startTop;
    let newWidth = startWidth;
    let newHeight = startHeight;

    if (direction.includes('e')) {
      newWidth = Math.max(minWidth, startWidth + dx);
    }
    if (direction.includes('w')) {
      newWidth = Math.max(minWidth, startWidth - dx);
      newLeft = startLeft + (startWidth - newWidth);
    }
    if (direction.includes('s')) {
      newHeight = Math.max(minHeight, startHeight + dy);
    }
    if (direction.includes('n')) {
      newHeight = Math.max(minHeight, startHeight - dy);
      newTop = startTop + (startHeight - newHeight);
    }

    if (keepAspectRatio) {
      if (direction === 'e' || direction === 'w') {
        newHeight = newWidth / aspectRatio;
      } else if (direction === 'n' || direction === 's') {
        newWidth = newHeight * aspectRatio;
      } else if (direction === 'nw' || direction === 'ne' || direction === 'sw' || direction === 'se') {
        if (Math.abs(newWidth - startWidth) > Math.abs(newHeight - startHeight)) {
          newHeight = newWidth / aspectRatio;
          if (direction.includes('n')) {
            newTop = startTop + (startHeight - newHeight);
          }
        } else {
          newWidth = newHeight * aspectRatio;
          if (direction.includes('w')) {
            newLeft = startLeft + (startWidth - newWidth);
          }
        }
      }
    }

    this._lastResult = { left: newLeft, top: newTop, width: newWidth, height: newHeight };
    return this._lastResult;
  }
}

export interface ResizeGestureOptions {
  direction: ResizeDirection;
  getPoint: (e: PointerEvent | MouseEvent) => { x: number; y: number };
  getStartRect: () => ResizeRect;
  keepAspectRatio: (e: PointerEvent | MouseEvent) => boolean;
  minWidth?: number;
  minHeight?: number;
  onMove: (rect: ResizeResult, e: PointerEvent | MouseEvent) => void;
  onEnd: (rect: ResizeResult, cancelled: boolean, distance: number) => void;
  threshold?: number;
}

export class ResizeGesture {
  private options: ResizeGestureOptions;
  private dragger: Dragger;
  private resizer: Resizer | null = null;
  private lastKeepRatio: boolean | null = null;
  private lastRect: ResizeResult;

  constructor(options: ResizeGestureOptions) {
    this.options = options;
    this.lastRect = { left: 0, top: 0, width: 0, height: 0 };
    this.dragger = new Dragger({
      getPoint: options.getPoint,
      threshold: options.threshold,
      onMove: (ctx: DragMoveContext) => this.handleMove(ctx),
      onEnd: (ctx: DragEndContext) => this.handleEnd(ctx),
    });
  }

  private ensureResizer(e: PointerEvent | MouseEvent): Resizer {
    const keepRatio = this.options.keepAspectRatio(e);
    if (this.resizer && this.lastKeepRatio === keepRatio) {
      return this.resizer;
    }
    const startRect = this.options.getStartRect();
    const aspectRatio = startRect.width / startRect.height;
    this.resizer = new Resizer({
      ...startRect,
      direction: this.options.direction,
      aspectRatio,
      keepAspectRatio: keepRatio,
      minWidth: this.options.minWidth,
      minHeight: this.options.minHeight,
    });
    this.lastKeepRatio = keepRatio;
    return this.resizer;
  }

  private handleMove(ctx: DragMoveContext): void {
    const resizer = this.ensureResizer(ctx.event);
    this.lastRect = resizer.update(ctx.dx, ctx.dy);
    this.options.onMove(this.lastRect, ctx.event);
  }

  private handleEnd(ctx: DragEndContext): void {
    if (!this.resizer) {
      this.lastRect = this.options.getStartRect();
    }
    this.options.onEnd(this.lastRect, ctx.cancelled, ctx.distance);
  }

  start(e: PointerEvent | MouseEvent): void {
    this.dragger.start(e);
  }

  cancel(): void {
    this.dragger.cancel();
  }

  destroy(): void {
    this.dragger.destroy();
  }
}
