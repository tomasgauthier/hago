/**
 * Browser automation tools using Playwright
 */

import { chromium, type Browser, type Page, type BrowserContext } from 'playwright';
import { z } from 'zod';
import type { ToolDefinition, ToolExecutionContext } from '../registry.js';
import type { PermissionManager } from '../../../utils/permissions.js';
import { PermissionLevel } from '../../../utils/permissions.js';
import type { Logger } from 'pino';

/**
 * Browser automation manager with session management
 */
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

/**
 * Create browser automation tools
 */
export function createBrowserTools(
  logger: Logger,
  permissions: PermissionManager,
  browserManager: BrowserManager
): ToolDefinition[] {
  return [
    // Navigate to URL
    {
      name: 'browser_navigate',
      description: 'Navigate to a URL in the browser. Use this to visit websites and load web pages.',
      parameters: z.object({
        url: z.string().describe('The URL to navigate to'),
        waitUntil: z
          .enum(['load', 'domcontentloaded', 'networkidle'])
          .optional()
          .default('load')
          .describe('When to consider navigation successful'),
      }),
      execute: async (params: any, context?: ToolExecutionContext) => {
        const { url, waitUntil } = params;

        // Check permissions
        permissions.checkPermission('browser_navigate', PermissionLevel.EXECUTE_SAFE);
        permissions.checkDomain(url);

        const page = await browserManager.getOrCreatePage(context?.sessionKey || 'default');

        try {
          await page.goto(url, { waitUntil, timeout: 30000 });
          const title = await page.title();
          const currentUrl = page.url();

          logger.info({ url, title }, 'Browser navigated to URL');

          return `Successfully navigated to ${currentUrl}\nPage title: ${title}`;
        } catch (error) {
          logger.error({ error, url }, 'Failed to navigate to URL');
          return `Failed to navigate to ${url}: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },

    // Get page content
    {
      name: 'browser_get_content',
      description: 'Get the text content of the current page. Useful for extracting information from web pages.',
      parameters: z.object({
        selector: z
          .string()
          .optional()
          .describe('Optional CSS selector to get content from a specific element'),
      }),
      execute: async (params: any, context?: ToolExecutionContext) => {
        const { selector } = params;

        permissions.checkPermission('browser_get_content', PermissionLevel.READ_ONLY);

        const page = await browserManager.getOrCreatePage(context?.sessionKey || 'default');

        try {
          let content: string;
          if (selector) {
            const element = await page.$(selector);
            if (!element) {
              return `No element found matching selector: ${selector}`;
            }
            content = (await element.textContent()) || '';
          } else {
            content = await page.textContent('body') || '';
          }

          // Truncate if too long
          const maxLength = 10000;
          if (content.length > maxLength) {
            content = content.substring(0, maxLength) + '\n... (truncated)';
          }

          logger.info({ selector, contentLength: content.length }, 'Retrieved page content');
          return content;
        } catch (error) {
          logger.error({ error, selector }, 'Failed to get page content');
          return `Failed to get content: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },

    // Click element
    {
      name: 'browser_click',
      description: 'Click an element on the page using a CSS selector. Useful for interacting with buttons, links, etc.',
      parameters: z.object({
        selector: z.string().describe('CSS selector for the element to click'),
        waitForNavigation: z
          .boolean()
          .optional()
          .default(false)
          .describe('Wait for navigation after clicking'),
      }),
      execute: async (params: any, context?: ToolExecutionContext) => {
        const { selector, waitForNavigation } = params;

        permissions.checkPermission('browser_click', PermissionLevel.EXECUTE_SAFE);

        const page = await browserManager.getOrCreatePage(context?.sessionKey || 'default');

        try {
          const element = await page.$(selector);
          if (!element) {
            return `No element found matching selector: ${selector}`;
          }

          if (waitForNavigation) {
            await Promise.all([
              page.waitForNavigation({ timeout: 30000 }),
              element.click(),
            ]);
          } else {
            await element.click();
          }

          logger.info({ selector }, 'Clicked element');
          return `Successfully clicked element: ${selector}`;
        } catch (error) {
          logger.error({ error, selector }, 'Failed to click element');
          return `Failed to click element: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },

    // Fill form field
    {
      name: 'browser_fill',
      description: 'Fill a form field with text. Use CSS selector to target the input element.',
      parameters: z.object({
        selector: z.string().describe('CSS selector for the input field'),
        value: z.string().describe('Text to fill into the field'),
      }),
      execute: async (params: any, context?: ToolExecutionContext) => {
        const { selector, value } = params;

        permissions.checkPermission('browser_fill', PermissionLevel.EXECUTE_SAFE);

        const page = await browserManager.getOrCreatePage(context?.sessionKey || 'default');

        try {
          await page.fill(selector, value);
          logger.info({ selector }, 'Filled form field');
          return `Successfully filled field: ${selector}`;
        } catch (error) {
          logger.error({ error, selector }, 'Failed to fill form field');
          return `Failed to fill field: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },

    // Take screenshot
    {
      name: 'browser_screenshot',
      description: 'Take a screenshot of the current page or a specific element. Returns the path to the saved screenshot.',
      parameters: z.object({
        selector: z
          .string()
          .optional()
          .describe('Optional CSS selector to screenshot a specific element'),
        fullPage: z
          .boolean()
          .optional()
          .default(false)
          .describe('Take a full page screenshot'),
      }),
      execute: async (params: any, context?: ToolExecutionContext) => {
        const { selector, fullPage } = params;

        permissions.checkPermission('browser_screenshot', PermissionLevel.EXECUTE_SAFE);

        const page = await browserManager.getOrCreatePage(context?.sessionKey || 'default');

        try {
          const timestamp = Date.now();
          const filename = `screenshot_${timestamp}.png`;
          const path = `./data/screenshots/${filename}`;

          // Ensure screenshots directory exists
          const fs = await import('fs/promises');
          await fs.mkdir('./data/screenshots', { recursive: true });

          if (selector) {
            const element = await page.$(selector);
            if (!element) {
              return `No element found matching selector: ${selector}`;
            }
            await element.screenshot({ path });
          } else {
            await page.screenshot({ path, fullPage });
          }

          logger.info({ path, selector, fullPage }, 'Took screenshot');
          return `Screenshot saved to: ${path}`;
        } catch (error) {
          logger.error({ error }, 'Failed to take screenshot');
          return `Failed to take screenshot: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },

    // Evaluate JavaScript
    {
      name: 'browser_evaluate',
      description: 'Execute JavaScript code in the browser context and return the result. Use with caution.',
      parameters: z.object({
        code: z.string().describe('JavaScript code to execute'),
      }),
      execute: async (params: any, context?: ToolExecutionContext) => {
        const { code } = params;

        permissions.checkPermission('browser_evaluate', PermissionLevel.EXECUTE_SAFE);

        const page = await browserManager.getOrCreatePage(context?.sessionKey || 'default');

        try {
          const result = await page.evaluate(code);
          logger.info({ codeLength: code.length }, 'Evaluated JavaScript');
          return `Result: ${JSON.stringify(result, null, 2)}`;
        } catch (error) {
          logger.error({ error, code }, 'Failed to evaluate JavaScript');
          return `Failed to evaluate JavaScript: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },

    // Wait for selector
    {
      name: 'browser_wait_for',
      description: 'Wait for an element to appear on the page. Useful when content loads dynamically.',
      parameters: z.object({
        selector: z.string().describe('CSS selector to wait for'),
        timeoutMs: z
          .number()
          .optional()
          .default(30000)
          .describe('Maximum time to wait in milliseconds'),
      }),
      execute: async (params: any, context?: ToolExecutionContext) => {
        const { selector, timeoutMs } = params;

        permissions.checkPermission('browser_wait_for', PermissionLevel.EXECUTE_SAFE);

        const page = await browserManager.getOrCreatePage(context?.sessionKey || 'default');

        try {
          await page.waitForSelector(selector, { timeout: timeoutMs });
          logger.info({ selector, timeoutMs }, 'Element appeared');
          return `Element appeared: ${selector}`;
        } catch (error) {
          logger.error({ error, selector }, 'Element did not appear');
          return `Element did not appear within timeout: ${selector}`;
        }
      },
    },

    // Close browser session
    {
      name: 'browser_close',
      description: 'Close the browser session for this conversation. Use when done with browser automation.',
      parameters: z.object({}),
      execute: async (_params: any, context?: ToolExecutionContext) => {
        permissions.checkPermission('browser_close', PermissionLevel.EXECUTE_SAFE);

        await browserManager.closePage(context?.sessionKey || 'default');
        logger.info({ sessionKey: context?.sessionKey || 'default' }, 'Closed browser session');
        return 'Browser session closed';
      },
    },
  ];
}
