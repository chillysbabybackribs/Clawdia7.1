export type BrowserExecutionMode = 'headed' | 'headless' | 'persistent_session';

export interface BrowserViewportBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserTabState {
  id: string;
  title: string;
  url: string;
  active: boolean;
  isLoading: boolean;
  faviconUrl?: string;
  isNewTab: boolean;
}

export interface BrowserPageState {
  url: string;
  title: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  textSample: string;
}

/** Deterministic page profile collected immediately after navigation — no LLM involved. */
export interface PageProfile {
  /** Hostname of the page (e.g. "www.reddit.com") */
  hostname: string;
  /** Detected JS framework(s) active on the page */
  frameworks: string[];
  /** All interactable input selectors with metadata */
  inputs: Array<{
    selector: string;
    type: string;
    placeholder: string;
    label: string;
    inShadowDom: boolean;
  }>;
  /** All buttons with their visible text */
  buttons: Array<{ selector: string; text: string }>;
  /** All links (up to 30) */
  links: Array<{ href: string; text: string }>;
  /** Top-level forms with their field selectors */
  forms: Array<{ action: string; method: string; fields: string[] }>;
  /** Whether any input/textarea lives inside a shadow root */
  hasShadowInputs: boolean;
  /** Content landmark selectors present (main, article, [role=feed], etc.) */
  contentAreas: string[];
  /** Auth state hint — true if a user avatar/username element was found */
  likelyLoggedIn: boolean;
}

export interface BrowserNavigationResult {
  tabId: string;
  url: string;
  title: string;
  /** Page profile collected synchronously after load — available immediately */
  profile?: PageProfile;
}

export interface BrowserScreenshotResult {
  path: string;
  mimeType: string;
  width: number;
  height: number;
}

export interface BrowserServiceResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface BrowserServiceEvents {
  urlChanged: (url: string) => void;
  titleChanged: (title: string) => void;
  loadingChanged: (loading: boolean) => void;
  tabsChanged: (tabs: BrowserTabState[]) => void;
  modeChanged: (payload: { mode: BrowserExecutionMode }) => void;
}

export interface BrowserService {
  // Browser panel/view control lives here and is intentionally distinct from
  // brokered browser capability actions such as navigate/extract/screenshot.
  setBounds(bounds: BrowserViewportBounds): void;
  getExecutionMode(): Promise<BrowserExecutionMode>;
  open(url?: string): Promise<BrowserNavigationResult>;
  navigate(url: string): Promise<BrowserNavigationResult>;
  back(): Promise<void>;
  forward(): Promise<void>;
  refresh(): Promise<void>;
  newTab(url?: string): Promise<BrowserTabState>;
  listTabs(): Promise<BrowserTabState[]>;
  switchTab(id: string): Promise<void>;
  closeTab(id: string): Promise<void>;
  matchHistory(prefix: string): Promise<string | null>;
  hide(): Promise<void>;
  show(): Promise<void>;
  getPageState(): Promise<BrowserPageState>;
  extractText(): Promise<{ url: string; title: string; text: string }>;
  screenshot(): Promise<BrowserScreenshotResult>;
  /** Click an element identified by CSS selector */
  click(selector: string): Promise<BrowserServiceResult>;
  /** Type text into an element identified by CSS selector. If clearFirst, clears existing value first. */
  type(selector: string, text: string, clearFirst?: boolean): Promise<BrowserServiceResult>;
  /** Scroll to an element by CSS selector (or scroll window by deltaY pixels if selector is null) */
  scroll(selector: string | null, deltaY?: number): Promise<BrowserServiceResult>;
  /** Wait until a CSS selector is present in DOM. Returns error on timeout. */
  waitFor(selector: string, timeoutMs?: number): Promise<BrowserServiceResult>;
  /** Evaluate a JS expression in the page context and return the serializable result */
  evaluateJs(expression: string): Promise<BrowserServiceResult>;
  /** Return { url, title, readyState } of current page */
  getPageInfo(): Promise<BrowserServiceResult>;
  /** Find elements matching a CSS selector, return array of { tag, text, attrs } */
  findElements(selector: string, limit?: number): Promise<BrowserServiceResult>;
  /** Select an option in a <select> element by value or visible text */
  select(selector: string, value: string): Promise<BrowserServiceResult>;
  /** Hover over an element to trigger mouseover/mouseenter events */
  hover(selector: string): Promise<BrowserServiceResult>;
  /** Press a keyboard key (e.g. Enter, Escape, Tab, ArrowDown) */
  keyPress(key: string): Promise<BrowserServiceResult>;
  /** Get the visible text content of an element matching a CSS selector */
  getElementText(selector: string): Promise<BrowserServiceResult>;
  /** Run the deterministic page profiler and return a PageProfile */
  profilePage(): Promise<PageProfile>;
  // Session maintenance is currently treated as browser UI/session management,
  // not as a brokered capability mutation.
  listSessions(): Promise<string[]>;
  clearSession(domain: string): Promise<void>;
  on<K extends keyof BrowserServiceEvents>(event: K, listener: BrowserServiceEvents[K]): () => void;

  // ── Conversation-scoped tab ownership ────────────────────────────────────────
  // Each conversation that uses browser tools gets its own dedicated tab.
  // Agent tool calls must go through getConvTab(conversationId) to retrieve
  // the tab ID, then use switchTab + the operation, or use the scoped helpers
  // that handle routing automatically via withConvId.
  //
  // getOrAssignTab: idempotently creates and returns a tab ID for the given
  //   conversation. Subsequent calls return the same tab ID until it is released.
  // releaseTab: removes the conversation→tab mapping and closes the tab.
  //   Called on conversation deletion or on explicit cleanup.
  // focusConversation: activates the conversation's owned tab as the visible
  //   browser panel. Creates the tab lazily if it has never been used. This is
  //   a UI-only operation — it does not affect execution routing.
  getOrAssignTab(conversationId: string): Promise<string>;
  releaseTab(conversationId: string): Promise<void>;
  focusConversation(conversationId: string): Promise<void>;
}
