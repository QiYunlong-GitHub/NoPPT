import type { LayoutRule } from '../types';
import { outerContainerRequiredStyles } from './outer-container-required-styles';
import { forbiddenWritingMode } from './forbidden-writing-mode';
import { noAbsPosAsMainLayout } from './no-abs-pos-as-main-layout';
import { noCardHeight100 } from './no-card-height-100';
import { gridNeedsAlignContent } from './grid-needs-align-content';
import { iconSpanWrappedByStyledP } from './icon-span-wrapped-by-styled-p';
import { decorativeNeedsPointerEventsNone } from './decorative-needs-pointer-events-none';
import { noNeonCyberCliche } from './no-neon-cyber-cliche';
import { colorCountLimit } from './color-count-limit';
import { fontFamilyLimit } from './font-family-limit';
import { fontSizeHierarchy } from './font-size-hierarchy';
import { spacingGrid } from './spacing-grid';
import { noTextWatermark } from './no-text-watermark';
import { noLoremIpsum } from './no-lorem-ipsum';
import { imageSideColumnViolation } from './image-side-column-violation';

export const rules: LayoutRule[] = [
  outerContainerRequiredStyles,
  forbiddenWritingMode,
  noAbsPosAsMainLayout,
  noCardHeight100,
  gridNeedsAlignContent,
  iconSpanWrappedByStyledP,
  decorativeNeedsPointerEventsNone,
  noNeonCyberCliche,
  colorCountLimit,
  fontFamilyLimit,
  fontSizeHierarchy,
  spacingGrid,
  noTextWatermark,
  noLoremIpsum,
  imageSideColumnViolation,
];
