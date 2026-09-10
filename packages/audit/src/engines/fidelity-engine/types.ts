export interface OverflowRecord {
  selector: string;
  tagName: string;
  overflowX: number;
  overflowY: number;
  clientWidth: number;
  clientHeight: number;
  scrollWidth: number;
  scrollHeight: number;
}

export interface OverlapRecord {
  element1: { selector: string; rect: { x: number; y: number; width: number; height: number } };
  element2: { selector: string; rect: { x: number; y: number; width: number; height: number } };
  overlapArea: number;
  isContentObscured: boolean;
}

export interface TruncationRecord {
  selector: string;
  tagName: string;
  clientWidth: number;
  scrollWidth: number;
  truncated: boolean;
}

export interface ImageLoadRecord {
  selector: string;
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  loaded: boolean;
}

export interface LayoutShiftRecord {
  selector: string;
  issue: string;
  detail: string;
}
