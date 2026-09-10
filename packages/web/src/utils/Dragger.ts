export interface DragStartContext {
  startX: number;
  startY: number;
  pointerId?: number;
}

export interface DragMoveContext extends DragStartContext {
  dx: number;
  dy: number;
  event: PointerEvent | MouseEvent;
}

export interface DragEndContext extends DragMoveContext {
  cancelled: boolean;
  distance: number;
}

export interface DraggerOptions {
  getPoint: (e: PointerEvent | MouseEvent) => { x: number; y: number };
  onStart?: (ctx: DragStartContext) => void;
  onMove?: (ctx: DragMoveContext) => void;
  onEnd?: (ctx: DragEndContext) => void;
  threshold?: number;
  capture?: boolean;
}

export class Dragger {
  private options: DraggerOptions;
  private startX = 0;
  private startY = 0;
  private lastX = 0;
  private lastY = 0;
  private pointerId?: number;
  private active = false;
  private started = false;
  private usePointer = false;
  private boundMove: (e: PointerEvent | MouseEvent) => void;
  private boundUp: (e: PointerEvent | MouseEvent) => void;
  private boundKey: (e: KeyboardEvent) => void;
  private target: Element | null = null;

  constructor(options: DraggerOptions) {
    this.options = options;
    this.boundMove = this.onMove.bind(this);
    this.boundUp = this.onUp.bind(this);
    this.boundKey = this.onKey.bind(this);
  }

  start(e: PointerEvent | MouseEvent): void {
    if (this.started) return;
    this.started = true;
    this.active = false;

    const pt = this.options.getPoint(e);
    this.startX = pt.x;
    this.startY = pt.y;
    this.lastX = pt.x;
    this.lastY = pt.y;

    this.usePointer = typeof window !== 'undefined' && 'PointerEvent' in window && e instanceof PointerEvent;
    this.target = e.target as Element | null;

    if (this.usePointer) {
      this.pointerId = (e as PointerEvent).pointerId;
      if (this.options.capture !== false && this.target) {
        try {
          (this.target as Element).setPointerCapture?.(this.pointerId!);
        } catch {
          // ignore
        }
      }
      window.addEventListener('pointermove', this.boundMove as EventListener);
      window.addEventListener('pointerup', this.boundUp as EventListener);
      window.addEventListener('pointercancel', this.boundUp as EventListener);
    } else {
      window.addEventListener('mousemove', this.boundMove as EventListener);
      window.addEventListener('mouseup', this.boundUp as EventListener);
    }
    window.addEventListener('keydown', this.boundKey);

    this.options.onStart?.({ startX: this.startX, startY: this.startY, pointerId: this.pointerId });
  }

  private onMove(e: PointerEvent | MouseEvent): void {
    if (!this.started) return;
    const pt = this.options.getPoint(e);
    this.lastX = pt.x;
    this.lastY = pt.y;

    const dx = pt.x - this.startX;
    const dy = pt.y - this.startY;

    const threshold = this.options.threshold ?? 0;
    if (!this.active) {
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < threshold) return;
      this.active = true;
    }

    this.options.onMove?.({
      startX: this.startX,
      startY: this.startY,
      dx,
      dy,
      event: e,
      pointerId: this.pointerId,
    });
  }

  private onUp(e: PointerEvent | MouseEvent): void {
    if (!this.started) return;
    const pt = this.options.getPoint(e);
    this.lastX = pt.x;
    this.lastY = pt.y;
    const dx = pt.x - this.startX;
    const dy = pt.y - this.startY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    this.cleanup();

    this.options.onEnd?.({
      startX: this.startX,
      startY: this.startY,
      dx,
      dy,
      event: e,
      cancelled: false,
      distance,
      pointerId: this.pointerId,
    });
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.cancel();
    }
  }

  cancel(): void {
    if (!this.started) return;
    const dx = this.lastX - this.startX;
    const dy = this.lastY - this.startY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    this.cleanup();

    this.options.onEnd?.({
      startX: this.startX,
      startY: this.startY,
      dx,
      dy,
      event: new MouseEvent('mouseup') as MouseEvent,
      cancelled: true,
      distance,
      pointerId: this.pointerId,
    });
  }

  private cleanup(): void {
    if (this.usePointer) {
      window.removeEventListener('pointermove', this.boundMove as EventListener);
      window.removeEventListener('pointerup', this.boundUp as EventListener);
      window.removeEventListener('pointercancel', this.boundUp as EventListener);
      if (this.options.capture !== false && this.target && this.pointerId !== undefined) {
        try {
          (this.target as Element).releasePointerCapture?.(this.pointerId);
        } catch {
          // ignore
        }
      }
    } else {
      window.removeEventListener('mousemove', this.boundMove as EventListener);
      window.removeEventListener('mouseup', this.boundUp as EventListener);
    }
    window.removeEventListener('keydown', this.boundKey);
    this.started = false;
    this.active = false;
    this.target = null;
  }

  destroy(): void {
    if (!this.started) return;
    this.cleanup();
  }
}
