import type { CDPSession, Page } from 'puppeteer';

/**
 * Controls browser window state (minimize/restore) during task execution
 * to avoid interference between the playground UI and desktop automation.
 */
export class BrowserWindowController {
  private session: CDPSession;
  private page: Page;
  private windowId: number;
  private unavailable = false;

  constructor(session: CDPSession, page: Page, windowId: number) {
    this.session = session;
    this.page = page;
    this.windowId = windowId;
  }

  private markUnavailableIfSessionClosed(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    const sessionClosed =
      this.page.isClosed() ||
      /Session closed|Target closed|target has been closed|Protocol error/i.test(
        message,
      );

    if (sessionClosed) {
      if (!this.unavailable) {
        console.warn(
          '⚠️  Playground window control session is closed; skipping automatic window control.',
        );
      }
      this.unavailable = true;
      return true;
    }

    return false;
  }

  async minimize(): Promise<void> {
    if (this.unavailable) {
      return;
    }

    try {
      await this.session.send('Browser.setWindowBounds', {
        windowId: this.windowId,
        bounds: { windowState: 'minimized' },
      });
      console.log('🔽 Window minimized, starting task execution...');
    } catch (error) {
      if (!this.markUnavailableIfSessionClosed(error)) {
        console.warn('⚠️  Failed to minimize window:', error);
      }
    }
  }

  async restore(): Promise<void> {
    if (this.unavailable) {
      return;
    }

    try {
      await Promise.all([
        this.session.send('Browser.setWindowBounds', {
          windowId: this.windowId,
          bounds: { windowState: 'normal' },
        }),
        this.page.bringToFront(),
      ]);
      console.log('🔼 Window restored');
    } catch (error) {
      if (!this.markUnavailableIfSessionClosed(error)) {
        console.warn('⚠️  Failed to restore window:', error);
      }
    }
  }
}
