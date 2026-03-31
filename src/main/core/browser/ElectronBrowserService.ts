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
  PageProfile,
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

  // ── Conversation-scoped tab ownership ────────────────────────────────────────
  // Maps conversationId → tabId. Each agent conversation gets its own dedicated
  // browser tab so concurrent runs cannot corrupt each other's page state.
  private readonly convTabMap = new Map<string, string>();

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
    const result = this.currentNavigationResult();
    result.profile = await this.profilePage();
    return result;
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
    // Only include domains that have a real auth session cookie.
    // Requirements:
    //   1. Name matches a known session/auth pattern
    //   2. httpOnly=true — real auth cookies are always httpOnly; tracking/analytics cookies are not
    //   3. Non-empty value — rules out placeholder/opt-out cookies
    const SESSION_COOKIE_PATTERN = /^(session|sess|auth|access_token|refresh_token|id_token|jwt|user_session|login|logged_in|_session|PHPSESSID|JSESSIONID|connect\.sid|remember_me|remember_token)$/i;
    const authDomains = new Set<string>();
    for (const cookie of cookies) {
      if (
        cookie.domain &&
        cookie.httpOnly &&
        cookie.value &&
        SESSION_COOKIE_PATTERN.test(cookie.name)
      ) {
        authDomains.add(cookie.domain.replace(/^\./, ''));
      }
    }
    return [...authDomains].sort();
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
      // Get element centre coords so we can send a real mouse event via Chromium,
      // not just a synthetic JS click — this works on shadow-DOM, canvas overlays, etc.
      const rect = await wc.executeJavaScript(`
        (function() {
          function deepQuery(root, sel) {
            let el = root.querySelector(sel);
            if (el) return el;
            const all = root.querySelectorAll('*');
            for (const node of all) {
              if (node.shadowRoot) {
                el = deepQuery(node.shadowRoot, sel);
                if (el) return el;
              }
            }
            return null;
          }
          const el = deepQuery(document, ${JSON.stringify(selector)});
          if (!el) return null;
          el.focus();
          const r = el.getBoundingClientRect();
          return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        })()
      `);
      if (!rect) return { ok: false, error: `Element not found: ${selector}` };

      // Real Chromium-level mouse events hit every event listener including React/Vue synthetic
      for (const type of ['mouseDown', 'mouseUp'] as const) {
        wc.sendInputEvent({
          type,
          x: rect.x,
          y: rect.y,
          button: 'left',
          clickCount: 1,
        } as any);
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /**
   * Universal text input — works on ALL of:
   *   • Native <input> / <textarea>                       → sendInputEvent 'char' per character
   *   • React / Vue / Angular controlled inputs           → sendInputEvent 'char' per character
   *   • contenteditable divs (role=textbox)               → execCommand('insertText')
   *   • Lexical, ProseMirror, Draft.js, Slate, TipTap    → execCommand('insertText')
   *   • CodeMirror (CM6 uses contenteditable internally)  → execCommand('insertText')
   *
   * Two-path strategy based on element kind:
   *
   * PATH A — Native inputs (<input>, <textarea>):
   *   1. Focus via real Chromium mouseDown/mouseUp at element centre coords.
   *   2. Clear: override via native value setter (React-compatible) + dispatch input event.
   *   3. Type: wc.sendInputEvent({ type: 'char', keyCode: ch }) per character.
   *      This is a genuine Chromium-level char event — identical to physical keyboard input —
   *      so React/Vue synthetic event handlers fire automatically.
   *
   * PATH B — contenteditable / rich-text editors:
   *   1. Focus via real Chromium mouseDown/mouseUp.
   *   2. Clear: execCommand('selectAll') + execCommand('delete') — triggers the editor's own
   *      internal selection + delete path, so its document model stays consistent.
   *   3. Type: execCommand('insertText', false, fullText) — fires a 'beforeinput' InputEvent
   *      with inputType='insertText', which is the standard contract every rich-text framework
   *      (Lexical, ProseMirror, Draft.js, Slate, TipTap, CM6) listens to.
   *      Single execCommand call is atomic — no per-character delay needed.
   */
  async type(selector: string, text: string, clearFirst = true): Promise<BrowserServiceResult> {
    const wc = this.getActiveWebContents();
    if (!wc) return { ok: false, error: 'No active browser tab' };
    try {
      // ── Step 1: locate element, classify it, get centre coords ──────────────
      const info = await wc.executeJavaScript(`
        (function() {
          function deepQuery(root, sel) {
            let el = root.querySelector(sel);
            if (el) return el;
            const all = root.querySelectorAll('*');
            for (const node of all) {
              if (node.shadowRoot) {
                el = deepQuery(node.shadowRoot, sel);
                if (el) return el;
              }
            }
            return null;
          }
          const el = deepQuery(document, ${JSON.stringify(selector)});
          if (!el) return null;
          const tag = el.tagName.toLowerCase();
          const isNative = tag === 'input' || tag === 'textarea';
          const isContentEditable = !isNative && (
            el.isContentEditable ||
            el.getAttribute('contenteditable') === 'true' ||
            el.getAttribute('contenteditable') === ''
          );
          const r = el.getBoundingClientRect();
          return {
            isNative,
            isContentEditable,
            x: Math.round(r.left + r.width / 2),
            y: Math.round(r.top + r.height / 2),
          };
        })()
      `);

      if (!info) return { ok: false, error: `Element not found: ${selector}` };

      // ── Step 2: focus via real Chromium mouse events ─────────────────────────
      // Using sendInputEvent mouseDown/mouseUp rather than JS .focus() ensures the
      // OS-level focus state is set and framework focus handlers (onFocus, FocusEvent) fire.
      for (const evType of ['mouseDown', 'mouseUp'] as const) {
        wc.sendInputEvent({ type: evType, x: info.x, y: info.y, button: 'left', clickCount: 1 } as any);
      }
      // Allow the editor's focus handler / cursor mount to settle
      await new Promise(r => setTimeout(r, 60));

      // ── Step 3: clear + type, branched by element kind ───────────────────────
      if (info.isNative) {
        // PATH A: native <input> / <textarea>
        if (clearFirst) {
          await wc.executeJavaScript(`
            (function() {
              function deepQuery(root, sel) {
                let el = root.querySelector(sel);
                if (el) return el;
                const all = root.querySelectorAll('*');
                for (const node of all) {
                  if (node.shadowRoot) { el = deepQuery(node.shadowRoot, sel); if (el) return el; }
                }
                return null;
              }
              const el = deepQuery(document, ${JSON.stringify(selector)});
              if (!el) return;
              // Use the native property setter so React's synthetic onChange fires
              const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
              if (setter) setter.call(el, ''); else el.value = '';
              el.dispatchEvent(new Event('input', { bubbles: true }));
            })()
          `);
        }
        // Type each character as a genuine Chromium char event
        for (const char of text) {
          wc.sendInputEvent({ type: 'char', keyCode: char } as any);
          // Small inter-character delay avoids dropped chars in async-event editors
          await new Promise(r => setTimeout(r, 12));
        }
      } else {
        // PATH B: contenteditable / rich-text editor
        // execCommand('insertText') fires a beforeinput InputEvent that every framework handles
        await wc.executeJavaScript(`
          (function() {
            function deepQuery(root, sel) {
              let el = root.querySelector(sel);
              if (el) return el;
              const all = root.querySelectorAll('*');
              for (const node of all) {
                if (node.shadowRoot) { el = deepQuery(node.shadowRoot, sel); if (el) return el; }
              }
              return null;
            }
            const el = deepQuery(document, ${JSON.stringify(selector)});
            if (!el) return;
            el.focus();
            if (${clearFirst}) {
              document.execCommand('selectAll', false);
              document.execCommand('delete', false);
            }
            // Single atomic insert — works with Lexical, ProseMirror, Draft.js, Slate, TipTap, CM6
            document.execCommand('insertText', false, ${JSON.stringify(text)});
          })()
        `);
      }

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
        const found = await wc.executeJavaScript(`
          (function() {
            function deepQuery(root, sel) {
              let el = root.querySelector(sel);
              if (el) return el;
              for (const node of root.querySelectorAll('*')) {
                if (node.shadowRoot) { el = deepQuery(node.shadowRoot, sel); if (el) return el; }
              }
              return null;
            }
            return !!deepQuery(document, ${JSON.stringify(selector)});
          })()
        `);
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
            function deepQuery(root, sel) {
              let el = root.querySelector(sel);
              if (el) return el;
              const all = root.querySelectorAll('*');
              for (const node of all) {
                if (node.shadowRoot) { el = deepQuery(node.shadowRoot, sel); if (el) return el; }
              }
              return null;
            }
            const el = deepQuery(document, ${JSON.stringify(selector)});
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
          function deepQueryAll(root, sel, results) {
            for (const el of root.querySelectorAll(sel)) results.push(el);
            for (const node of root.querySelectorAll('*')) {
              if (node.shadowRoot) deepQueryAll(node.shadowRoot, sel, results);
            }
          }
          const nodes = [];
          deepQueryAll(document, ${JSON.stringify(selector)}, nodes);
          return nodes.slice(0, ${limit}).map(el => ({
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
          function deepQuery(root, sel) {
            let el = root.querySelector(sel);
            if (el) return el;
            const all = root.querySelectorAll('*');
            for (const node of all) {
              if (node.shadowRoot) { el = deepQuery(node.shadowRoot, sel); if (el) return el; }
            }
            return null;
          }
          const el = deepQuery(document, ${JSON.stringify(selector)});
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
          function deepQuery(root, sel) {
            let el = root.querySelector(sel);
            if (el) return el;
            const all = root.querySelectorAll('*');
            for (const node of all) {
              if (node.shadowRoot) { el = deepQuery(node.shadowRoot, sel); if (el) return el; }
            }
            return null;
          }
          const el = deepQuery(document, ${JSON.stringify(selector)});
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

  async profilePage(): Promise<PageProfile> {
    const wc = this.getActiveWebContents();
    if (!wc) {
      return {
        hostname: '', frameworks: [], inputs: [], buttons: [], links: [],
        forms: [], hasShadowInputs: false, contentAreas: [], likelyLoggedIn: false,
      };
    }
    return this.profilePageOn(wc);
  }

  // ── Conversation-scoped tab API ───────────────────────────────────────────────

  async getOrAssignTab(conversationId: string): Promise<string> {
    const existing = this.convTabMap.get(conversationId);
    if (existing && this.tabs.has(existing)) return existing;
    // Create a dedicated tab for this conversation (not activated into the UI view).
    const id = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const view = new BrowserView({
      webPreferences: { partition: PARTITION, sandbox: false },
    });
    const tab: InternalTab = {
      id,
      view,
      state: { id, title: 'Agent Tab', url: '', active: false, isLoading: false, isNewTab: true },
    };
    this.tabs.set(id, tab);
    this.bindTabEvents(tab);
    this.convTabMap.set(conversationId, id);
    void this.listTabs().then((tabs) => this.emit('tabsChanged', tabs));
    return id;
  }

  async releaseTab(conversationId: string): Promise<void> {
    const tabId = this.convTabMap.get(conversationId);
    if (!tabId) return;
    this.convTabMap.delete(conversationId);
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    // If this tab is currently shown in the window, detach it first.
    if (this.window.getBrowserView() === tab.view) this.window.setBrowserView(null);
    tab.view.webContents.close();
    this.tabs.delete(tabId);
    if (this.activeTabId === tabId) {
      this.activeTabId = null;
      const next = [...this.tabs.values()][0];
      if (next) await this.activateTab(next);
    } else {
      void this.listTabs().then((tabs) => this.emit('tabsChanged', tabs));
    }
  }

  /**
   * Activate the browser panel to show the tab owned by this conversation.
   * This stays lazy: switching chat tabs must not allocate a browser tab.
   * Execution routing still creates conversation-owned tabs via getOrAssignTab().
   */
  async focusConversation(conversationId: string): Promise<void> {
    const tabId = this.convTabMap.get(conversationId);
    if (!tabId) return;
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    console.log(`[BrowserService] Switched browser to conversation ${conversationId} → tab ${tabId}`);
    await this.activateTab(tab);
  }

  /**
   * Execute a browser operation on a specific tab identified by tabId, without
   * changing activeTabId. This is the core isolation primitive: agent tool calls
   * resolve their conversation's tab via getOrAssignTab(), then pass the webContents
   * directly to the operation. The UI panel's activeTabId is never disturbed.
   */
  private getTabWebContents(tabId: string): Electron.WebContents | null {
    return this.tabs.get(tabId)?.view?.webContents ?? null;
  }

  /**
   * Navigate a specific tab by ID without touching activeTabId.
   * Used by agent browser tools to operate on their conversation-owned tab.
   */
  async navigateTab(tabId: string, url: string): Promise<BrowserNavigationResult> {
    const tab = this.tabs.get(tabId);
    if (!tab) throw new Error(`Tab ${tabId} not found`);
    tab.state.isNewTab = false;
    await this.loadUrlReady(tab.view.webContents, url);
    this.history.add(url);
    const result: BrowserNavigationResult = {
      tabId: tab.id,
      url: tab.view.webContents.getURL(),
      title: tab.view.webContents.getTitle(),
    };
    result.profile = await this.profilePageOn(tab.view.webContents);
    return result;
  }

  /** Run a JS expression on a specific tab's webContents. */
  async evaluateJsOnTab(tabId: string, expression: string): Promise<BrowserServiceResult> {
    const wc = this.getTabWebContents(tabId);
    if (!wc) return { ok: false, error: `Tab ${tabId} not found` };
    try {
      const result = await wc.executeJavaScript(expression);
      return { ok: true, data: result };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /** Get page state from a specific tab. */
  async getPageStateOnTab(tabId: string): Promise<BrowserPageState> {
    const tab = this.tabs.get(tabId);
    if (!tab) throw new Error(`Tab ${tabId} not found`);
    const wc = tab.view.webContents;
    const textSample = await wc.executeJavaScript(
      `(() => (document.body?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 1200))()`,
    );
    return {
      url: wc.getURL(),
      title: wc.getTitle(),
      isLoading: wc.isLoading(),
      canGoBack: this.canGoBack(wc),
      canGoForward: this.canGoForward(wc),
      textSample: String(textSample || ''),
    };
  }

  /** Extract text from a specific tab. */
  async extractTextOnTab(tabId: string): Promise<{ url: string; title: string; text: string; truncated: boolean }> {
    const tab = this.tabs.get(tabId);
    if (!tab) throw new Error(`Tab ${tabId} not found`);
    const wc = tab.view.webContents;
    const MAX_CHARS = 5500;
    const text = await wc.executeJavaScript(
      `(() => (document.body?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, ${MAX_CHARS + 1}))()`,
    );
    const raw = String(text || '');
    const truncated = raw.length > MAX_CHARS;
    return {
      url: wc.getURL(),
      title: wc.getTitle(),
      text: truncated ? raw.slice(0, MAX_CHARS) : raw,
      truncated,
    };
  }

  /** Screenshot a specific tab. */
  async screenshotTab(tabId: string): Promise<BrowserScreenshotResult> {
    const tab = this.tabs.get(tabId);
    if (!tab) throw new Error(`Tab ${tabId} not found`);
    const image = await tab.view.webContents.capturePage();
    const png = image.toPNG();
    const dir = path.join(this.userDataPath, 'browser-screenshots');
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `browser-${Date.now()}.png`);
    await fs.writeFile(filePath, png);
    const size = image.getSize();
    return { path: filePath, mimeType: 'image/png', width: size.width, height: size.height };
  }

  /** Click on a specific tab. */
  async clickOnTab(tabId: string, selector: string): Promise<BrowserServiceResult> {
    const wc = this.getTabWebContents(tabId);
    if (!wc) return { ok: false, error: `Tab ${tabId} not found` };
    try {
      const rect = await wc.executeJavaScript(`
        (function() {
          function deepQuery(root, sel) {
            let el = root.querySelector(sel);
            if (el) return el;
            for (const node of root.querySelectorAll('*')) {
              if (node.shadowRoot) { el = deepQuery(node.shadowRoot, sel); if (el) return el; }
            }
            return null;
          }
          const el = deepQuery(document, ${JSON.stringify(selector)});
          if (!el) return null;
          el.focus();
          const r = el.getBoundingClientRect();
          return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        })()
      `);
      if (!rect) return { ok: false, error: `Element not found: ${selector}` };
      for (const type of ['mouseDown', 'mouseUp'] as const) {
        wc.sendInputEvent({ type, x: rect.x, y: rect.y, button: 'left', clickCount: 1 } as any);
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /** Type into a specific tab. */
  async typeOnTab(tabId: string, selector: string, text: string, clearFirst = true): Promise<BrowserServiceResult> {
    const wc = this.getTabWebContents(tabId);
    if (!wc) return { ok: false, error: `Tab ${tabId} not found` };
    try {
      const info = await wc.executeJavaScript(`
        (function() {
          function deepQuery(root, sel) {
            let el = root.querySelector(sel);
            if (el) return el;
            for (const node of root.querySelectorAll('*')) {
              if (node.shadowRoot) { el = deepQuery(node.shadowRoot, sel); if (el) return el; }
            }
            return null;
          }
          const el = deepQuery(document, ${JSON.stringify(selector)});
          if (!el) return null;
          const tag = el.tagName.toLowerCase();
          const isNative = tag === 'input' || tag === 'textarea';
          const isContentEditable = !isNative && (
            el.isContentEditable || el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === ''
          );
          const r = el.getBoundingClientRect();
          return { isNative, isContentEditable, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        })()
      `);
      if (!info) return { ok: false, error: `Element not found: ${selector}` };
      for (const evType of ['mouseDown', 'mouseUp'] as const) {
        wc.sendInputEvent({ type: evType, x: info.x, y: info.y, button: 'left', clickCount: 1 } as any);
      }
      await new Promise(r => setTimeout(r, 60));
      if (info.isNative) {
        if (clearFirst) {
          await wc.executeJavaScript(`
            (function() {
              function deepQuery(root, sel) {
                let el = root.querySelector(sel);
                if (el) return el;
                for (const node of root.querySelectorAll('*')) {
                  if (node.shadowRoot) { el = deepQuery(node.shadowRoot, sel); if (el) return el; }
                }
                return null;
              }
              const el = deepQuery(document, ${JSON.stringify(selector)});
              if (!el) return;
              const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
              if (setter) setter.call(el, ''); else el.value = '';
              el.dispatchEvent(new Event('input', { bubbles: true }));
            })()
          `);
        }
        for (const char of text) {
          wc.sendInputEvent({ type: 'char', keyCode: char } as any);
          await new Promise(r => setTimeout(r, 12));
        }
      } else {
        await wc.executeJavaScript(`
          (function() {
            function deepQuery(root, sel) {
              let el = root.querySelector(sel);
              if (el) return el;
              for (const node of root.querySelectorAll('*')) {
                if (node.shadowRoot) { el = deepQuery(node.shadowRoot, sel); if (el) return el; }
              }
              return null;
            }
            const el = deepQuery(document, ${JSON.stringify(selector)});
            if (!el) return;
            el.focus();
            if (${clearFirst}) {
              document.execCommand('selectAll', false);
              document.execCommand('delete', false);
            }
            document.execCommand('insertText', false, ${JSON.stringify(text)});
          })()
        `);
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /** Scroll on a specific tab. */
  async scrollOnTab(tabId: string, selector: string | null, deltaY = 500): Promise<BrowserServiceResult> {
    const wc = this.getTabWebContents(tabId);
    if (!wc) return { ok: false, error: `Tab ${tabId} not found` };
    try {
      if (selector) {
        await wc.executeJavaScript(`
          (function() {
            function deepQuery(root, sel) {
              let el = root.querySelector(sel);
              if (el) return el;
              for (const node of root.querySelectorAll('*')) {
                if (node.shadowRoot) { el = deepQuery(node.shadowRoot, sel); if (el) return el; }
              }
              return null;
            }
            const el = deepQuery(document, ${JSON.stringify(selector)});
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

  /** Wait for selector on a specific tab. */
  async waitForOnTab(tabId: string, selector: string, timeoutMs = 10000): Promise<BrowserServiceResult> {
    const wc = this.getTabWebContents(tabId);
    if (!wc) return { ok: false, error: `Tab ${tabId} not found` };
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const found = await wc.executeJavaScript(`
          (function() {
            function deepQuery(root, sel) {
              let el = root.querySelector(sel);
              if (el) return el;
              for (const node of root.querySelectorAll('*')) {
                if (node.shadowRoot) { el = deepQuery(node.shadowRoot, sel); if (el) return el; }
              }
              return null;
            }
            return !!deepQuery(document, ${JSON.stringify(selector)});
          })()
        `);
        if (found) return { ok: true };
      } catch { /* page may be mid-navigation */ }
      await new Promise(r => setTimeout(r, 200));
    }
    return { ok: false, error: `Timeout (${timeoutMs}ms) waiting for selector: ${selector}` };
  }

  /** Find elements on a specific tab. */
  async findElementsOnTab(tabId: string, selector: string, limit = 20): Promise<BrowserServiceResult> {
    const wc = this.getTabWebContents(tabId);
    if (!wc) return { ok: false, error: `Tab ${tabId} not found` };
    try {
      const elements = await wc.executeJavaScript(`
        (function() {
          function deepQueryAll(root, sel, results) {
            for (const el of root.querySelectorAll(sel)) results.push(el);
            for (const node of root.querySelectorAll('*')) {
              if (node.shadowRoot) deepQueryAll(node.shadowRoot, sel, results);
            }
          }
          const nodes = [];
          deepQueryAll(document, ${JSON.stringify(selector)}, nodes);
          return nodes.slice(0, ${limit}).map(el => ({
            tag: el.tagName.toLowerCase(),
            text: el.innerText?.slice(0, 200) ?? '',
            attrs: {
              id: el.id || undefined,
              class: el.className || undefined,
              href: el.getAttribute('href') || undefined,
              type: el.getAttribute('type') || undefined,
              placeholder: el.getAttribute('placeholder') || undefined,
              name: el.getAttribute('name') || undefined,
            }
          }));
        })()
      `);
      return { ok: true, data: elements };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /** Select on a specific tab. */
  async selectOnTab(tabId: string, selector: string, value: string): Promise<BrowserServiceResult> {
    const wc = this.getTabWebContents(tabId);
    if (!wc) return { ok: false, error: `Tab ${tabId} not found` };
    try {
      const found = await wc.executeJavaScript(`
        (function() {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el || el.tagName.toLowerCase() !== 'select') return false;
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

  /** Hover on a specific tab. */
  async hoverOnTab(tabId: string, selector: string): Promise<BrowserServiceResult> {
    const wc = this.getTabWebContents(tabId);
    if (!wc) return { ok: false, error: `Tab ${tabId} not found` };
    try {
      const found = await wc.executeJavaScript(`
        (function() {
          function deepQuery(root, sel) {
            let el = root.querySelector(sel);
            if (el) return el;
            for (const node of root.querySelectorAll('*')) {
              if (node.shadowRoot) { el = deepQuery(node.shadowRoot, sel); if (el) return el; }
            }
            return null;
          }
          const el = deepQuery(document, ${JSON.stringify(selector)});
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

  /** Key press on a specific tab. */
  async keyPressOnTab(tabId: string, key: string): Promise<BrowserServiceResult> {
    const wc = this.getTabWebContents(tabId);
    if (!wc) return { ok: false, error: `Tab ${tabId} not found` };
    try {
      wc.sendInputEvent({ type: 'keyDown', keyCode: key } as any);
      wc.sendInputEvent({ type: 'keyUp',   keyCode: key } as any);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /** Get element text on a specific tab. */
  async getElementTextOnTab(tabId: string, selector: string): Promise<BrowserServiceResult> {
    const wc = this.getTabWebContents(tabId);
    if (!wc) return { ok: false, error: `Tab ${tabId} not found` };
    try {
      const text = await wc.executeJavaScript(`
        (function() {
          function deepQuery(root, sel) {
            let el = root.querySelector(sel);
            if (el) return el;
            for (const node of root.querySelectorAll('*')) {
              if (node.shadowRoot) { el = deepQuery(node.shadowRoot, sel); if (el) return el; }
            }
            return null;
          }
          const el = deepQuery(document, ${JSON.stringify(selector)});
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

  /** Navigate back on a specific tab. */
  async backOnTab(tabId: string): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (tab && this.canGoBack(tab.view.webContents)) {
      tab.state.isNewTab = false;
      this.goBack(tab.view.webContents);
    }
  }

  /** Navigate forward on a specific tab. */
  async forwardOnTab(tabId: string): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (tab && this.canGoForward(tab.view.webContents)) {
      tab.state.isNewTab = false;
      this.goForward(tab.view.webContents);
    }
  }

  /** Profile page on a specific tab's webContents. */
  private async profilePageOn(wc: Electron.WebContents): Promise<PageProfile> {
    try {
      const profile = await wc.executeJavaScript(`
        (function() {
          function deepQuery(root, sel) {
            let el = root.querySelector(sel);
            if (el) return el;
            for (const node of root.querySelectorAll('*')) {
              if (node.shadowRoot) { el = deepQuery(node.shadowRoot, sel); if (el) return el; }
            }
            return null;
          }
          function deepQueryAll(root, sel, results, inShadow) {
            for (const el of root.querySelectorAll(sel)) results.push({ el, inShadow });
            for (const node of root.querySelectorAll('*')) {
              if (node.shadowRoot) deepQueryAll(node.shadowRoot, sel, results, true);
            }
          }
          const frameworks = [];
          if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__ || document.querySelector('[data-reactroot],[data-reactid]')) frameworks.push('React');
          if (window.Vue || document.querySelector('[data-v-]')) frameworks.push('Vue');
          if (window.angular || document.querySelector('[ng-version]')) frameworks.push('Angular');
          if (window.Svelte || document.querySelector('[data-svelte]')) frameworks.push('Svelte');
          if (window.next) frameworks.push('Next.js');
          if (window.nuxt) frameworks.push('Nuxt');
          if (document.querySelector('.ProseMirror')) frameworks.push('ProseMirror');
          if (document.querySelector('[data-lexical-editor]')) frameworks.push('Lexical');
          if (document.querySelector('.DraftEditor-root')) frameworks.push('Draft.js');
          if (document.querySelector('.tiptap')) frameworks.push('TipTap');
          if (document.querySelector('.cm-editor,.CodeMirror')) frameworks.push('CodeMirror');
          const inputResults = [];
          deepQueryAll(document, 'input:not([type=hidden]),textarea,[contenteditable="true"],[contenteditable=""]', inputResults, false);
          const inputs = inputResults.slice(0, 30).map(({ el, inShadow }) => {
            const tag = el.tagName.toLowerCase();
            const type = el.getAttribute('type') || tag;
            const placeholder = el.getAttribute('placeholder') || '';
            let label = '';
            if (el.id) { const lbl = document.querySelector('label[for="' + el.id + '"]'); if (lbl) label = lbl.innerText.trim().slice(0, 60); }
            if (!label) { const aria = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || ''; label = aria.slice(0, 60); }
            let selector = tag;
            if (el.id) selector = '#' + CSS.escape(el.id);
            else if (el.name) selector = tag + '[name="' + el.name + '"]';
            else if (el.getAttribute('type')) selector = tag + '[type="' + el.getAttribute('type') + '"]';
            return { selector, type, placeholder: placeholder.slice(0, 80), label, inShadowDom: inShadow };
          });
          const hasShadowInputs = inputs.some(i => i.inShadowDom);
          const buttonResults = [];
          deepQueryAll(document, 'button,[role=button],[type=submit]', buttonResults, false);
          const buttons = buttonResults.slice(0, 20).map(({ el }) => {
            let selector = el.tagName.toLowerCase();
            if (el.id) selector = '#' + CSS.escape(el.id);
            else if (el.getAttribute('type')) selector = el.tagName.toLowerCase() + '[type="' + el.getAttribute('type') + '"]';
            return { selector, text: (el.innerText || el.textContent || '').trim().slice(0, 60) };
          });
          const links = Array.from(document.querySelectorAll('a[href]')).slice(0, 30).map(el => ({
            href: el.getAttribute('href') || '',
            text: (el.innerText || '').trim().slice(0, 60),
          }));
          const forms = Array.from(document.querySelectorAll('form')).slice(0, 10).map(form => {
            const fields = Array.from(form.querySelectorAll('input:not([type=hidden]),textarea,select')).map(el => {
              if (el.id) return '#' + CSS.escape(el.id);
              if (el.name) return el.tagName.toLowerCase() + '[name="' + el.name + '"]';
              return el.tagName.toLowerCase();
            });
            return { action: form.getAttribute('action') || '', method: (form.getAttribute('method') || 'get').toUpperCase(), fields };
          });
          const contentSelectors = ['main','article','[role="main"]','[role="feed"]','[role="list"]','#content','#main','.content','.main'];
          const contentAreas = contentSelectors.filter(s => document.querySelector(s));
          const authSelectors = ['[data-username]','[data-user]','[data-testid*="user"]','[data-testid*="avatar"]',
            '.avatar','#header-user','[class*="username"]','[class*="userAvatar"]','[aria-label*="profile" i]'];
          const likelyLoggedIn = authSelectors.some(s => document.querySelector(s));
          return { hostname: location.hostname, frameworks, inputs, buttons, links, forms, hasShadowInputs, contentAreas, likelyLoggedIn };
        })()
      `);
      return profile as PageProfile;
    } catch {
      return { hostname: '', frameworks: [], inputs: [], buttons: [], links: [], forms: [], hasShadowInputs: false, contentAreas: [], likelyLoggedIn: false };
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
