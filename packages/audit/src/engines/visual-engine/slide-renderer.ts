import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import * as path from 'path';
import * as fs from 'fs';
import { decodePNG } from './png-decoder';
import type { ImageDataLike } from './png-decoder';
import {
  EVALUATOR_SMOKE_SCRIPT,
  LAYOUT_METRICS_EVALUATOR,
  validateBrowserEvaluatorResult,
  type BrowserEvaluatorResult,
} from './browser-evaluator';

export type ViewportProfile = 'narrow' | 'standard' | 'wide';

export interface SlideRendererOptions {
  width?: number;
  height?: number;
  /** 服务器 data 根目录绝对路径。虚拟路径前缀 `/data/workspace` 映射为 `${workspaceDir}/workspace` */
  workspaceDir?: string;
}

export interface FontReadiness {
  available: boolean;
  ready: boolean;
  status: 'ready' | 'unverified' | 'failed';
  reason?: string;
}

export interface ImageReadiness {
  total: number;
  loaded: number;
  failed: number;
  pending: number;
  status: 'ready' | 'unverified' | 'failed';
  reason?: string;
}

export interface ResourceReadiness {
  fonts: FontReadiness;
  images: ImageReadiness;
}

export interface RectMetrics {
  x: number;
  y: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

export interface ElementMetrics {
  selector: string;
  tagName: string;
  role: string;
  contentId?: string;
  text: string;
  required: boolean;
  emptyRequired: boolean;
  clipped: boolean;
  rect: RectMetrics;
  scrollWidth: number;
  clientWidth: number;
  scrollHeight: number;
  clientHeight: number;
  computed: {
    display: string;
    visibility: string;
    overflow: string;
    overflowX: string;
    overflowY: string;
    fontFamily: string;
    fontWeight: string;
    fontSize: string;
    lineHeight: string;
  };
}

export interface LayoutMetrics {
  viewport: { width: number; height: number; profile: ViewportProfile };
  logicalCanvas: { width: number; height: number };
  root: RectMetrics;
  document: {
    scrollWidth: number;
    scrollHeight: number;
    clientWidth: number;
    clientHeight: number;
  };
  elements: ElementMetrics[];
  requiredClipped: number;
  emptyRequiredNodes: number;
  horizontalOverflow: boolean;
  verticalOverflow: boolean;
  titleOverlap: boolean;
}

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

const SYSTEM_BROWSER_PATHS: Record<string, string[]> = {
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/msedge',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ],
};

function findSystemBrowser(): string | undefined {
  const candidates = SYSTEM_BROWSER_PATHS[process.platform] || [];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

export function viewportProfile(width: number): ViewportProfile {
  return width < 1000 ? 'narrow' : width > 1400 ? 'wide' : 'standard';
}

export class SlideRenderer {
  private browser: Browser | null = null;
  private viewport: { width: number; height: number };
  private workspaceDir?: string;
  private fontReadiness = new WeakMap<Page, FontReadiness>();
  private resourceReadiness = new WeakMap<Page, ResourceReadiness>();

  constructor(options: SlideRendererOptions = {}) {
    this.viewport = {
      width: options.width ?? 1280,
      height: options.height ?? 720,
    };
    this.workspaceDir = options.workspaceDir;
  }

  private async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      const launchArgs = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];

      const envPath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
      if (envPath && fs.existsSync(envPath)) {
        this.browser = await chromium.launch({
          headless: true,
          executablePath: envPath,
          args: launchArgs,
        });
        return this.browser;
      }

      try {
        this.browser = await chromium.launch({ headless: true, args: launchArgs });
        return this.browser;
      } catch (err) {
        const systemBrowser = findSystemBrowser();
        if (!systemBrowser) throw err;
        this.browser = await chromium.launch({
          headless: true,
          executablePath: systemBrowser,
          args: launchArgs,
        });
      }
    }
    return this.browser;
  }

  async initialize(): Promise<void> {
    await this.getBrowser();
  }

  async renderSlide(html: string): Promise<Page> {
    const browser = await this.getBrowser();
    const page = await browser.newPage({ viewport: this.viewport });
    html = this.inlineLocalImages(html);
    await page.setContent(html, { waitUntil: 'networkidle' });
    await this.runEvaluatorSmoke(page);
    await this.waitForResources(page);
    await page.waitForTimeout(150);
    return page;
  }

  /** Wait for browser font loading without treating an unknown Font Loading API as a pass. */
  async waitForFonts(page: Page): Promise<FontReadiness> {
    const readiness = await page.evaluate(async (): Promise<FontReadiness> => {
      const fonts = (document as Document & {
        fonts?: { ready?: Promise<unknown> };
      }).fonts;
      if (!fonts || !fonts.ready) {
        return {
          available: false,
          ready: false,
          status: 'unverified',
          reason: 'document.fonts is unavailable',
        };
      }
      try {
        await fonts.ready;
        return { available: true, ready: true, status: 'ready' };
      } catch (error) {
        return {
          available: true,
          ready: false,
          status: 'failed',
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    });
    this.fontReadiness.set(page, readiness);
    return readiness;
  }

  /** Wait for fonts and images before any geometry or screenshot read. */
  async waitForResources(page: Page): Promise<ResourceReadiness> {
    const fonts = await this.waitForFonts(page);
    const images = await page.evaluate(async (): Promise<ImageReadiness> => {
      const imageElements = Array.from(document.images);
      const pending = imageElements.filter((image) => !image.complete);
      if (pending.length > 0) {
        await Promise.race([
          Promise.all(
            pending.map(
              (image) =>
                new Promise<void>((resolve) => {
                  image.addEventListener('load', () => resolve(), { once: true });
                  image.addEventListener('error', () => resolve(), { once: true });
                }),
            ),
          ),
          new Promise<void>((resolve) => window.setTimeout(resolve, 5000)),
        ]);
      }
      const failed = imageElements.filter((image) => image.complete && image.naturalWidth === 0).length;
      const loaded = imageElements.filter((image) => image.complete && image.naturalWidth > 0).length;
      const remaining = imageElements.filter((image) => !image.complete).length;
      return {
        total: imageElements.length,
        loaded,
        failed,
        pending: remaining,
        status: failed > 0 ? 'failed' : remaining > 0 ? 'unverified' : 'ready',
        reason: failed > 0 ? `${failed} image resource(s) failed to load` : remaining > 0 ? 'image load timeout' : undefined,
      };
    });
    const readiness = { fonts, images };
    this.resourceReadiness.set(page, readiness);
    return readiness;
  }

  getFontReadiness(page: Page): FontReadiness | undefined {
    return this.fontReadiness.get(page);
  }

  getResourceReadiness(page: Page): ResourceReadiness | undefined {
    return this.resourceReadiness.get(page);
  }

  /** Evaluate only browser-native source and reject missing/changed result contracts. */
  async runEvaluatorSmoke(page: Page): Promise<void> {
    const result = await page.evaluate(EVALUATOR_SMOKE_SCRIPT);
    if (!result || typeof result !== 'object' || (result as { evaluator?: string }).evaluator !== 'noppt' || (result as { version?: number }).version !== 1 || (result as { ok?: boolean }).ok !== true) {
      throw new Error('browser evaluator smoke assertion failed');
    }
  }

  /** Collect all required geometry/style data in one self-contained browser evaluation. */
  async collectLayoutMetrics(page: Page): Promise<LayoutMetrics> {
    const size = page.viewportSize() ?? this.viewport;
    await this.runEvaluatorSmoke(page);
    const result = await page.evaluate(`${LAYOUT_METRICS_EVALUATOR}(${JSON.stringify({
      width: size.width,
      height: size.height,
      profile: viewportProfile(size.width),
    })})`);
    validateBrowserEvaluatorResult(result);
    return result as BrowserEvaluatorResult as LayoutMetrics;
  }

  /** 将 html 中 `src="/data/workspace/<rest>"` 的本地相对路径内嵌为 dataURI。 */
  private inlineLocalImages(html: string): string {
    if (!this.workspaceDir) return html;
    return html.replace(
      /(<img\b[^>]*\bsrc=["'])\/data\/workspace\/([^"']+?)(["'][^>]*>)/gi,
      (full, before: string, rest: string, after: string) => {
        if (!rest) return full;
        const filePath = path.join(this.workspaceDir!, rest);
        let data: Buffer;
        try {
          data = fs.readFileSync(filePath);
        } catch {
          return full;
        }
        const ext = path.extname(filePath).toLowerCase().replace('.', '') || 'png';
        const mime = IMAGE_MIME[ext] || IMAGE_MIME.png;
        return `${before}data:${mime};base64,${data.toString('base64')}${after}`;
      },
    );
  }

  async captureScreenshot(page: Page, filePath: string): Promise<void> {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: filePath, type: 'png', fullPage: false });
  }

  async getImageData(page: Page): Promise<ImageDataLike> {
    const buffer = await page.screenshot({ type: 'png' });
    return decodePNG(buffer);
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
