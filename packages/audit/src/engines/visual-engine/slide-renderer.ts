import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import * as path from 'path';
import * as fs from 'fs';
import { decodePNG } from './png-decoder';
import type { ImageDataLike } from './png-decoder';

export interface SlideRendererOptions {
  width?: number;
  height?: number;
  /** 服务器 data 根目录绝对路径。虚拟路径前缀 `/data/workspace` 映射为 `${workspaceDir}/workspace` */
  workspaceDir?: string;
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
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
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

export class SlideRenderer {
  private browser: Browser | null = null;
  private viewport: { width: number; height: number };
  private workspaceDir?: string;

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
        if (!systemBrowser) {
          throw err;
        }
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
    await page.evaluate(() => (document as any).fonts?.ready);
    await page.waitForTimeout(150);
    return page;
  }

  /**
   * 将 html 中 `src="/data/workspace/<rest>"` 的本地相对路径内嵌为 dataURI，
   * 使 page.setContent(html) 渲染的页面（无 base URL）能正确显示图片。
   * 未配置 workspaceDir、文件不存在或读取失败时保持原始 URL 不变，
   * 已以 `data:` 开头的 src 不处理。
   */
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
