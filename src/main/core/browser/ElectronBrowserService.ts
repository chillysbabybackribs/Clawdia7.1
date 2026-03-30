import { BrowserView, BrowserWindow, session } from 'electron';
import { promises as fs } from 'fs';
import * as path from 'path';
import type {
  BrowserExecutionMode,
  BrowserNavigationResult,
  BrowserPageState,
  BrowserScreenshotResult,
  BrowserService,
  BrowserServiceEvents,
  BrowserServiceResult,
  BrowserTabState,
  BrowserViewportBounds,
} from './BrowserService';

interface InternalTab {
  id: string;
  view: BrowserView;
  state: BrowserTabState;
}

type ListenerMap = {
  [K in keyof BrowserServiceEvents]: Set<BrowserServiceEvents[K]>;
};

const PARTITION = 'persist:clawdia-browser';
const NAVIGATION_READY_TIMEOUT_MS = 8000;
const TAB_PERSIST_FILE = 'browser-tabs.json';

interface PersistedTab {
  url: string;
  active: boolean;
}

export class ElectronBrowserService implements BrowserService {
  private readonly listeners: ListenerMap = {
    urlChanged: new Set(),
    titleChanged: new Set(),
    loadingChanged: new Set(),
    tabsChanged: new Set(),
    modeChanged: new Set(),
  };
  private readonly tabs = new Map<string, InternalTab>();
  private readonly history = new Set<string>();
  private activeTabId: string | null = null;
  private bounds: BrowserViewportBounds = { x: 0, y: 0, width: 0, height: 0 };
  private visible = false;
  private readonly mode: BrowserExecutionMode = 'headed';
  // Deduplicates concurrent "ensure a default tab exists" calls so two BrowserPanel
  // instances mounting at the same time never both create a tab.
  private defaultTabPromise: Promise<void> | null = null;

  constructor(
    private readonly window: BrowserWindow,
    private readonly userDataPath: string,
  ) {}

  /** Call once after construction. Restores persisted tabs or creates the default Google tab. */
  async init(): Promise<void> {
    const tabsFilePath = path.join(this.userDataPath, TAB_PERSIST_FILE);
    let persisted: PersistedTab[] = [];
    try {
      const raw = await fs.readFile(tabsFilePath, 'utf8');
      persisted = JSON.parse(raw) as PersistedTab[];
    } catch {
      // No saved state — start fresh
    }

    const validTabs = persisted.filter(t => t.url && t.url.startsWith('http'));
    if (validTabs.length === 0) {
      return;
    }

    // Restore tabs in order; activate the one that was active (or the last one)
    const activeIndex = validTabs.findIndex(t => t.active);
    for (let i = 0; i < validTabs.length; i++) {
      await this.newTab(validTabs[i].url);
    }
    // newTab activates each tab as it's created; re-activate the correct one
    const tabList = [...this.tabs.values()];
    const targetIndex = activeIndex >= 0 ? activeIndex : tabList.length - 1;
    if (tabList[targetIndex]) {
      await this.activateTab(tabList[targetIndex]);
    }
  }

  private get tabsFilePath(): string {
    return path.join(this.userDataPath, TAB_PERSIST_FILE);
  }

  private saveTabs(): void {
    const data: PersistedTab[] = [...this.tabs.values()].map(t => ({
      url: t.view.webContents.getURL() || t.state.url,
      active: t.state.active,
    }));
    // Fire-and-forget — don't block the event loop
    fs.writeFile(this.tabsFilePath, JSON.stringify(data), 'utf8').catch(() => {});
  }

  setBounds(bounds: BrowserViewportBounds): void {
    this.bounds = bounds;
    const active = this.getActiveTab();
    if (!active || !this.visible) return;
    active.view.setBounds(bounds);
  }

  async getExecutionMode(): Promise<BrowserExecutionMode> {
    return this.mode;
  }

  async open(url = 'https://www.google.com'): Promise<BrowserNavigationResult> {
    if (!this.activeTabId) {
      const tab = await this.newTab(url);
      return { tabId: tab.id, url: tab.url, title: tab.title };
    }
    return await this.navigate(url);
  }

  async navigate(url: string): Promise<BrowserNavigationResult> {
    const tab = await this.ensureActiveTab();
    tab.state.isNewTab = false;
    await this.loadUrlReady(tab.view.webContents, url);
    this.history.add(url);
    return this.currentNavigationResult();
  }

  async back(): Promise<void> {
    const tab = this.getActiveTab();
    if (tab && this.canGoBack(tab.view.webContents)) {
      tab.state.isNewTab = false;
      this.goBack(tab.view.webContents);
    }
  }

  async forward(): Promise<void> {
    const tab = this.getActiveTab();
    if (tab && this.canGoForward(tab.view.webContents)) {
      tab.state.isNewTab = false;
      this.goForward(tab.view.webContents);
    }
  }

  async refresh(): Promise<void> {
    this.getActiveTab()?.view.webContents.reload();
  }

  async newTab(url?: string): Promise<BrowserTabState> {
    const id = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const view = new BrowserView({
      webPreferences: {
        partition: PARTITION,
        sandbox: false,
      },
    });
    const tab: InternalTab = {
      id,
      view,
      state: {
        id,
        title: 'New Tab',
        url: '',
        active: false,
        isLoading: false,
        isNewTab: !url,
      },
    };
    this.tabs.set(id, tab);
    this.bindTabEvents(tab);
    await this.activateTab(tab);
    if (url) {
      await this.loadUrlReady(view.webContents, url);
      this.history.add(url);
    }
    return { ...tab.state };
  }

  async listTabs(): Promise<BrowserTabState[]> {
    // Ensure at least one tab exists. The promise is shared so concurrent calls
    // (e.g. two BrowserPanel instances mounting simultaneously) only create one tab.
    if (this.tabs.size === 0) {
      if (!this.defaultTabPromise) {
        this.defaultTabPromise = this.newTab().then(() => { this.defaultTabPromise = null; });
      }
      await this.defaultTabPromise;
    }
    return [...this.tabs.values()].map((tab) => ({ ...tab.state }));
  }

  async switchTab(id: string): Promise<void> {
    const tab = this.tabs.get(id);
    if (!tab) return;
    await this.activateTab(tab);
  }

  async closeTab(id: string): Promise<void> {
    const tab = this.tabs.get(id);
    if (!tab) return;
    if (this.window.getBrowserView() === tab.view) this.window.setBrowserView(null);
    tab.view.webContents.close();
    this.tabs.delete(id);

    if (this.activeTabId === id) {
      this.activeTabId = null;
      const next = [...this.tabs.values()][0];
      if (next) await this.activateTab(next);
    } else {
      this.emit('tabsChanged', await this.listTabs());
    }
  }

  async matchHistory(prefix: string): Promise<string | null> {
    const lower = prefix.toLowerCase();
    for (const url of [...this.history].reverse()) {
      if (url.toLowerCase().startsWith(lower) || url.toLowerCase().includes(lower)) return url;
    }
    return null;
  }

  async hide(): Promise<void> {
    this.visible = false;
    this.window.setBrowserView(null);
  }

  async show(): Promise<void> {
    this.visible = true;
    const active = this.getActiveTab();
    if (!active) return;
    this.window.setBrowserView(active.view);
    active.view.setBounds(this.bounds);
  }

  async getPageState(): Promise<BrowserPageState> {
    const tab = await this.ensureActiveTab();
    const textSample = await tab.view.webContents.executeJavaScript(
      `(() => (document.body?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 1200))()`,
    );
    return {
      url: tab.view.webContents.getURL(),
      title: tab.view.webContents.getTitle(),
      isLoading: tab.view.webContents.isLoading(),
      canGoBack: this.canGoBack(tab.view.webContents),
      canGoForward: this.canGoForward(tab.view.webContents),
      textSample: String(textSample || ''),
    };
  }

  async extractText(): Promise<{ url: string; title: string; text: string; truncated: boolean }> {
    const tab = await this.ensureActiveTab();
    const MAX_CHARS = 5500;
    const text = await tab.view.webContents.executeJavaScript(
      `(() => (document.body?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, ${MAX_CHARS + 1}))()`,
    );
    const raw = String(text || '');
    const truncated = raw.length > MAX_CHARS;
    return {
      url: tab.view.webContents.getURL(),
      title: tab.view.webContents.getTitle(),
      text: truncated ? raw.slice(0, MAX_CHARS) : raw,
      truncated,
    };
  }

  async screenshot(): Promise<BrowserScreenshotResult> {
    const tab = await this.ensureActiveTab();
    const image = await tab.view.webContents.capturePage();
    const png = image.toPNG();
    const dir = path.join(this.userDataPath, 'browser-screenshots');
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `browser-${Date.now()}.png`);
    await fs.writeFile(filePath, png);
    const size = image.getSize();
    return {
      path: filePath,
      mimeType: 'image/png',
      width: size.width,
      height: size.height,
    };
  }

  async listSessions(): Promise<string[]> {
    const cookies = await session.fromPartition(PARTITION).cookies.get({});
    const domains = new Set<string>();
    for (const cookie of cookies) {
      if (cookie.domain) domains.add(cookie.domain.replace(/^\./, ''));
    }
    return [...domains].sort();
  }

  async clearSession(domain: string): Promise<void> {
    const target = domain.replace(/^\./, '');
    const partition = session.fromPartition(PARTITION);
    const cookies = await partition.cookies.get({});
    await Promise.all(
      cookies
        .filter((cookie) => cookie.domain && cookie.domain.replace(/^\./, '') === target)
        .map((cookie) => {
          const normalizedDomain = (cookie.domain || '').replace(/^\./, '');
          const protocol = cookie.secure ? 'https://' : 'http://';
          const url = `${protocol}${normalizedDomain}${cookie.path}`;
          return partition.cookies.remove(url, cookie.name);
        }),
    );
  }

  on<K extends keyof BrowserServiceEvents>(event: K, listener: BrowserServiceEvents[K]): () => void {
    this.listeners[event].add(listener);
    return () => this.listeners[event].delete(listener);
  }

  async click(selector: string): Promise<BrowserServiceResult> {
    const wc = this.getActiveWebContents();
    if (!wc) return { ok: false, error: 'No active browser tab' };
    try {
      const found = await wc.executeJavaScript(`
        (function() {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return false;
          el.focus();
          el.click();
          return true;
        })()
      `);
      if (!found) return { ok: false, error: `Element not found: ${selector}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async type(selector: string, text: string, clearFirst = true): Promise<BrowserServiceResult> {
    const wc = this.getActiveWebContents();
    if (!wc) return { ok: false, error: 'No active browser tab' };
    try {
      const found = await wc.executeJavaScript(`
        (function() {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return false;
          el.focus();
          if (${clearFirst}) { el.value = ''; }
          el.value = ${JSON.stringify(text)};
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        })()
      `);
      if (!found) return { ok: false, error: `Element not found: ${selector}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async waitFor(selector: string, timeoutMs = 10000): Promise<BrowserServiceResult> {
    const wc = this.getActiveWebContents();
    if (!wc) return { ok: false, error: 'No active browser tab' };
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const found = await wc.executeJavaScript(
          `!!document.querySelector(${JSON.stringify(selector)})`
        );
        if (found) return { ok: true };
      } catch {
        // page may be mid-navigation — ignore and retry
      }
      await new Promise(r => setTimeout(r, 200));
    }
    return { ok: false, error: `Timeout (${timeoutMs}ms) waiting for selector: ${selector}` };
  }

  async evaluateJs(expression: string): Promise<BrowserServiceResult> {
    const wc = this.getActiveWebContents();
    if (!wc) return { ok: false, error: 'No active browser tab' };
    try {
      const result = await wc.executeJavaScript(expression);
      return { ok: true, data: result };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async scroll(selector: string | null, deltaY = 500): Promise<BrowserServiceResult> {
    const wc = this.getActiveWebContents();
    if (!wc) return { ok: false, error: 'No active browser tab' };
    try {
      if (selector) {
        await wc.executeJavaScript(`
          (function() {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          })()
        `);
      } else {
        await wc.executeJavaScript(`window.scrollBy(0, ${deltaY})`);
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async getPageInfo(): Promise<BrowserServiceResult> {
    const wc = this.getActiveWebContents();
    if (!wc) return { ok: false, error: 'No active browser tab' };
    try {
      const info = await wc.executeJavaScript(`
        ({ url: location.href, title: document.title, readyState: document.readyState })
      `);
      return { ok: true, data: info };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async findElements(selector: string, limit = 20): Promise<BrowserServiceResult> {
    const wc = this.getActiveWebContents();
    if (!wc) return { ok: false, error: 'No active browser tab' };
    try {
      const elements = await wc.executeJavaScript(`
        (function() {
          const nodes = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).slice(0, ${limit});
          return nodes.map(el => ({
            tag:  el.tagName.toLowerCase(),
            text: el.innerText?.slice(0, 200) ?? '',
            attrs: {
              id:          el.id || undefined,
              class:       el.className || undefined,
              href:        el.getAttribute('href') || undefined,
              type:        el.getAttribute('type') || undefined,
              placeholder: el.getAttribute('placeholder') || undefined,
              name:        el.getAttribute('name') || undefined,
            }
          }));
        })()
      `);
      return { ok: true, data: elements };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async select(selector: string, value: string): Promise<BrowserServiceResult> {
    const wc = this.getActiveWebContents();
    if (!wc) return { ok: false, error: 'No active browser tab' };
    try {
      const found = await wc.executeJavaScript(`
        (function() {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el || el.tagName.toLowerCase() !== 'select') return false;
          // Try matching by value first, then by visible text
          const optByValue = Array.from(el.options).find(o => o.value === ${JSON.stringify(value)});
          const optByText  = Array.from(el.options).find(o => o.text.trim() === ${JSON.stringify(value)});
          const opt = optByValue || optByText;
          if (!opt) return false;
          el.value = opt.value;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('input',  { bubbles: true }));
          return true;
        })()
      `);
      if (!found) return { ok: false, error: `Select element or option not found: ${selector} / ${value}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async hover(selector: string): Promise<BrowserServiceResult> {
    const wc = this.getActiveWebContents();
    if (!wc) return { ok: false, error: 'No active browser tab' };
    try {
      const found = await wc.executeJavaScript(`
        (function() {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return false;
          el.dispatchEvent(new MouseEvent('mouseover',  { bubbles: true }));
          el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
          return true;
        })()
      `);
      if (!found) return { ok: false, error: `Element not found: ${selector}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async keyPress(key: string): Promise<BrowserServiceResult> {
    const wc = this.getActiveWebContents();
    if (!wc) return { ok: false, error: 'No active browser tab' };
    try {
      wc.sendInputEvent({ type: 'keyDown', keyCode: key } as any);
      wc.sendInputEvent({ type: 'keyUp',   keyCode: key } as any);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async getElementText(selector: string): Promise<BrowserServiceResult> {
    const wc = this.getActiveWebContents();
    if (!wc) return { ok: false, error: 'No active browser tab' };
    try {
      const text = await wc.executeJavaScript(`
        (function() {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return null;
          return el.innerText || el.textContent || '';
        })()
      `);
      if (text === null) return { ok: false, error: `Element not found: ${selector}` };
      return { ok: true, data: String(text).trim() };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  private getActiveWebContents(): Electron.WebContents | null {
    if (!this.activeTabId) return null;
    const tab = this.tabs.get(this.activeTabId);
    return tab?.view?.webContents ?? null;
  }

  private async ensureActiveTab(): Promise<InternalTab> {
    const active = this.getActiveTab();
    if (active) return active;
    const created = await this.newTab();
    return this.tabs.get(created.id)!;
  }

  private getActiveTab(): InternalTab | null {
    return this.activeTabId ? this.tabs.get(this.activeTabId) || null : null;
  }

  private async activateTab(tab: InternalTab): Promise<void> {
    const current = this.getActiveTab();
    if (current && current.id !== tab.id) current.state.active = false;
    this.activeTabId = tab.id;
    tab.state.active = true;
    if (this.visible) {
      this.window.setBrowserView(tab.view);
      tab.view.setBounds(this.bounds);
    }
    this.emit('tabsChanged', await this.listTabs());
  }

  private bindTabEvents(tab: InternalTab): void {
    const wc = tab.view.webContents;
    const update = () => {
      tab.state.url = wc.getURL() || tab.state.url;
      tab.state.title = wc.getTitle() || tab.state.title;
      tab.state.isLoading = wc.isLoading();
      if (tab.id === this.activeTabId) {
        this.emit('urlChanged', tab.state.url);
        this.emit('titleChanged', tab.state.title);
        this.emit('loadingChanged', tab.state.isLoading);
      }
      void this.listTabs().then((tabs) => this.emit('tabsChanged', tabs));
    };

    wc.on('page-title-updated', () => update());
    wc.on('did-start-loading', () => update());
    wc.on('did-stop-loading', () => update());
    wc.on('did-navigate', (_event, url) => {
      tab.state.url = url;
      tab.state.isNewTab = false;
      this.history.add(url);
      update();
    });
    wc.on('did-navigate-in-page', (_event, url) => {
      tab.state.url = url;
      tab.state.isNewTab = false;
      this.history.add(url);
      update();
    });
    wc.on('page-favicon-updated', (_event, favicons) => {
      tab.state.faviconUrl = favicons[0];
      void this.listTabs().then((tabs) => this.emit('tabsChanged', tabs));
    });
  }

  private currentNavigationResult(): BrowserNavigationResult {
    const active = this.getActiveTab();
    if (!active) return { tabId: '', url: '', title: '' };
    return {
      tabId: active.id,
      url: active.view.webContents.getURL(),
      title: active.view.webContents.getTitle(),
    };
  }

  private async loadUrlReady(webContents: Electron.WebContents, url: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        clearTimeout(timeout);
        webContents.removeListener('did-navigate', onNavigate);
        webContents.removeListener('did-navigate-in-page', onNavigateInPage);
        webContents.removeListener('dom-ready', onDomReady);
        webContents.removeListener('did-fail-load', onFailLoad);
      };

      const finish = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };

      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(message));
      };

      const onNavigate = () => finish();
      const onNavigateInPage = () => finish();
      const onDomReady = () => finish();
      const onFailLoad = (
        _event: Electron.Event,
        errorCode: number,
        errorDescription: string,
        validatedURL: string,
        isMainFrame: boolean,
      ) => {
        if (!isMainFrame) return;
        fail(`Failed to load ${validatedURL || url}: ${errorDescription} (${errorCode})`);
      };

      const timeout = setTimeout(() => {
        finish();
      }, NAVIGATION_READY_TIMEOUT_MS);

      webContents.once('did-navigate', onNavigate);
      webContents.once('did-navigate-in-page', onNavigateInPage);
      webContents.once('dom-ready', onDomReady);
      webContents.once('did-fail-load', onFailLoad);

      void webContents.loadURL(url).catch((error) => {
        fail(error instanceof Error ? error.message : `Failed to load ${url}`);
      });
    });
  }

  private canGoBack(webContents: Electron.WebContents): boolean {
    const history = webContents.navigationHistory as {
      canGoBack?: () => boolean;
    } | undefined;
    if (history?.canGoBack) return history.canGoBack();
    return webContents.canGoBack();
  }

  private canGoForward(webContents: Electron.WebContents): boolean {
    const history = webContents.navigationHistory as {
      canGoForward?: () => boolean;
    } | undefined;
    if (history?.canGoForward) return history.canGoForward();
    return webContents.canGoForward();
  }

  private goBack(webContents: Electron.WebContents): void {
    const history = webContents.navigationHistory as {
      goBack?: () => void;
    } | undefined;
    if (history?.goBack) {
      history.goBack();
      return;
    }
    webContents.goBack();
  }

  private goForward(webContents: Electron.WebContents): void {
    const history = webContents.navigationHistory as {
      goForward?: () => void;
    } | undefined;
    if (history?.goForward) {
      history.goForward();
      return;
    }
    webContents.goForward();
  }

  private emit<K extends keyof BrowserServiceEvents>(
    event: K,
    payload: Parameters<BrowserServiceEvents[K]>[0],
  ): void {
    if (event === 'tabsChanged') this.saveTabs();
    this.listeners[event].forEach((listener) => {
      (listener as (value: typeof payload) => void)(payload);
    });
  }
}
