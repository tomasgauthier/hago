/**
 * Browser automation manager — session lifecycle for Playwright
 */

import { chromium, type Browser, type Page, type BrowserContext } from 'playwright';
import type { PermissionManager } from '../../../utils/permissions.js';
import type { Logger } from 'pino';

export class BrowserManager {
  private browser: Browser | null = null;
  private contexts = new Map<string, BrowserContext>();
  private pages = new Map<string, Page>();
  private logger: Logger;
  private permissions: PermissionManager;

  constructor(logger: Logger, permissions: PermissionManager) {
    this.logger = logger;
    this.permissions = permissions;
  }

  async ensureBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.logger.info('Launching Chromium browser');
      this.browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
    }
    return this.browser;
  }

  async getOrCreatePage(sessionKey: string): Promise<Page> {
    if (this.pages.has(sessionKey)) {
      return this.pages.get(sessionKey)!;
    }

    const browser = await this.ensureBrowser();
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();

    this.contexts.set(sessionKey, context);
    this.pages.set(sessionKey, page);

    this.logger.info({ sessionKey }, 'Created new browser page for session');
    return page;
  }

  async closePage(sessionKey: string): Promise<void> {
    const page = this.pages.get(sessionKey);
    const context = this.contexts.get(sessionKey);

    if (page) {
      await page.close();
      this.pages.delete(sessionKey);
    }

    if (context) {
      await context.close();
      this.contexts.delete(sessionKey);
    }

    this.logger.info({ sessionKey }, 'Closed browser page for session');
  }

  async closeAll(): Promise<void> {
    for (const [sessionKey] of this.pages) {
      await this.closePage(sessionKey);
    }

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.logger.info('Closed browser');
    }
  }
}
