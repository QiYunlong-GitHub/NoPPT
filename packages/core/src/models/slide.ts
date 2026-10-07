import type { ID } from '../types';
import type { DeckMaster, DeckMeta, DeckSlide } from '../deck/schema';

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
  /**
   * 结构化节点树（HTML 渲染与 PPTX 渲染共用的同一份数据真值）。
   * 可选字段：历史数据没有它，导出时走 DOM 解析兜底（`htmlToDeck`）。
   */
  deck?: DeckSlide;
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
  /** deck 级母版（背景 / 页眉页脚 / 页码 / logo / 占位符）。 */
  master?: DeckMaster;
  /** deck 级元信息（作者 / 主题 / 版本 → PPTX core_properties）。 */
  meta?: DeckMeta;
  createdAt: number;
  updatedAt: number;
  version: number;
  tags?: string[];
  thumbnail?: string;
}
