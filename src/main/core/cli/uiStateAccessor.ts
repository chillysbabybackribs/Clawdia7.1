/**
 * Thin accessor for live Clawdia UI state that the ui_state tools need.
 * The renderer pushes its current UI state via IPC; registerIpc.ts stores it
 * here so the agent tool layer can read it without circular imports.
 */

export interface ClawdiaUIState {
  /** Which right-side panel is visible: 'browser' | 'terminal' | 'editor' | null */
  activeRightPanel: 'browser' | 'terminal' | 'editor' | null;
  /** Which left-side view is shown: 'chat' | 'conversations' | 'settings' | 'processes' | 'agents' */
  activeView: 'chat' | 'conversations' | 'settings' | 'processes' | 'agents';
  /** Currently active conversation tab ID, not a browser tab ID */
  activeConversationId: string | null;
  /** All open conversation tab IDs, not browser tab IDs */
  openTabIds: string[];
  /** Active sidebar drawer mode (null if closed) */
  sidebarDrawer: string | null;
  /** Currently active provider */
  provider: string;
  /** Currently active model */
  model: string;
  /** Terminal session IDs that are open */
  terminalSessionIds: string[];
  /** Whether the browser panel is visible */
  browserVisible: boolean;
  /** Current browser URL (if browser panel is open) */
  browserUrl: string | null;
  /** Timestamp of last state push */
  updatedAt: number;
}

let _state: ClawdiaUIState | null = null;

export function setUIState(state: ClawdiaUIState): void {
  _state = state;
}

export function getUIState(): ClawdiaUIState | null {
  return _state;
}
