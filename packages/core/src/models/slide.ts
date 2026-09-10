import type { ID } from '../types';

export interface SlideElement {
  id: string;
  type:
    | 'heading'
    | 'paragraph'
    | 'list'
    | 'image'
    | 'card'
    | 'decoration'
    | 'table'
    | 'button'
    | 'other';
  tag: string;
  label: string;
  selector?: string;
}

export interface Slide {
  id: ID;
  title: string;
  html: string;
  notes?: string;
  elements?: SlideElement[];
  hidden: boolean;
  index: number;
  createdAt: number;
  updatedAt: number;
}

export interface Presentation {
  id: ID;
  title: string;
  description?: string;
  author?: string;
  slides: Slide[];
  selectedSlideId?: ID;
  zoom: number;
  width: number;
  height: number;
  transition: 'none' | 'fade' | 'slide' | 'zoom' | 'flip';
  createdAt: number;
  updatedAt: number;
  version: number;
  tags?: string[];
  thumbnail?: string;
}
