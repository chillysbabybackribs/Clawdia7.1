/**
 * Static UI map of the Clawdia application.
 *
 * This is a structured, queryable description of every view, panel, control,
 * and interactive element in Clawdia's interface. Combined with the live
 * ui_state tool (which reports what is currently visible), this gives the agent
 * a complete self-model of the app it is running inside.
 *
 * Layout overview:
 *   ┌─────────────────────────────────────────────────────────┐
 *   │  AppChrome  (36px header — always visible)              │
 *   ├────────────────────────┬────────────────────────────────┤
 *   │  Left pane (35%)       │  Right pane (65%) — optional   │
 *   │  ┌──────────────────┐  │  BrowserPanel  OR              │
 *   │  │  TabStrip (46px) │  │  TerminalPanel OR              │
 *   │  ├──────────────────┤  │  EditorPanel                   │
 *   │  │  Active view:    │  │  (none = left expands to 100%) │
 *   │  │  ChatPanel       │  │                                │
 *   │  │  ConversationView│  │                                │
 *   │  │  SettingsView    │  │                                │
 *   │  │  ProcessesPanel  │  │                                │
 *   │  │  CreateAgentPanel│  │                                │
 *   │  │  AgentDetailPanel│  │                                │
 *   │  └──────────────────┘  │                                │
 *   └────────────────────────┴────────────────────────────────┘
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UIElement {
  id: string;
  label: string;
  type: 'button' | 'input' | 'dropdown' | 'toggle' | 'panel' | 'view' | 'tab' | 'overlay' | 'section';
  parent: string | null;
  /** When is this element visible? */
  visibility: string;
  /** What does clicking / activating this element do? */
  action?: string;
  /** Keyboard shortcut if any */
  shortcut?: string;
  /** Current state values this element can have */
  states?: string[];
  /** Child element IDs */
  children?: string[];
  /** Additional notes for the agent */
  notes?: string;
}

export interface UIView {
  id: string;
  label: string;
  description: string;
  activatedBy: string;
  /** Top-level element IDs within this view */
  elements: string[];
}

export interface UIMap {
  views: UIView[];
  elements: Record<string, UIElement>;
  /** Keyboard shortcuts at the app level */
  shortcuts: Array<{ keys: string; action: string; description: string }>;
  /** Possible values for rightPaneMode */
  rightPaneModes: Array<{ value: string; description: string }>;
}

// ── Map definition ─────────────────────────────────────────────────────────────

export const CLAWDIA_UI_MAP: UIMap = {

  rightPaneModes: [
    { value: 'none',     description: 'Right pane hidden — left pane expands to 100% width' },
    { value: 'browser',  description: 'Embedded Chromium browser is visible (36% left / 65% right split)' },
    { value: 'terminal', description: 'Terminal emulator (xterm.js) is visible in the right pane' },
    { value: 'editor',   description: 'Code editor with multi-file tabs is visible in the right pane' },
  ],

  shortcuts: [
    { keys: 'Ctrl+N',     action: 'new_chat',         description: 'Start a new chat in the active conversation tab' },
    { keys: 'Ctrl+L',     action: 'new_chat',         description: 'Start a new chat (alias for Ctrl+N)' },
    { keys: 'Ctrl+,',     action: 'toggle_settings',  description: 'Toggle Settings view' },
    { keys: 'Ctrl+H',     action: 'toggle_history',   description: 'Toggle Conversations history view' },
    { keys: 'Ctrl+B',     action: 'toggle_browser',   description: 'Toggle browser right pane' },
    { keys: 'Escape',     action: 'return_to_chat',   description: 'Return to chat from any other view' },
    { keys: 'Enter',      action: 'send_message',     description: 'Send message (in InputBar when not streaming)' },
    { keys: 'Shift+Enter',action: 'newline',          description: 'Insert newline in message input' },
    { keys: 'Escape',     action: 'stop_stream',      description: 'Stop streaming response (in InputBar when streaming)' },
  ],

  views: [
    {
      id: 'view_chat',
      label: 'Chat',
      description: 'Primary conversation interface. Shows messages, streaming response, tool activity, approval banners, and the input bar.',
      activatedBy: 'Default view. Also: Escape key from other views, clicking a conversation tab, handleNewChat(), handleLoadConversation().',
      elements: ['tabstrip', 'chat_messages', 'chat_toolbar', 'inputbar', 'approval_banner', 'human_intervention_banner', 'shimmer'],
    },
    {
      id: 'view_conversations',
      label: 'Conversations',
      description: 'Browse and load past conversations from history.',
      activatedBy: 'Ctrl+H, history button in ChatPanel toolbar, or setActiveView("conversations").',
      elements: ['tabstrip', 'conversations_list'],
    },
    {
      id: 'view_settings',
      label: 'Settings',
      description: 'API keys, provider selection, model selection, unrestricted mode, policy profile, performance stance.',
      activatedBy: 'Ctrl+, or settings gear button in ChatPanel toolbar.',
      elements: ['tabstrip', 'settings_form'],
    },
    {
      id: 'view_processes',
      label: 'Processes',
      description: 'Running and completed agent runs. Shows approvals, run events, artifacts, tool call logs.',
      activatedBy: 'setActiveView("processes"), "Open review" from ApprovalBanner or HumanInterventionBanner.',
      elements: ['tabstrip', 'processes_list'],
    },
    {
      id: 'view_agent_create',
      label: 'Create Agent',
      description: 'Agent builder wizard for creating new saved agents.',
      activatedBy: 'setActiveView("agent-create").',
      elements: ['tabstrip', 'agent_create_form'],
    },
    {
      id: 'view_agent_detail',
      label: 'Agent Detail',
      description: 'View, edit, and run a specific saved agent.',
      activatedBy: 'setActiveView("agent-detail") with selectedAgentId.',
      elements: ['tabstrip', 'agent_detail_panel'],
    },
  ],

  elements: {

    // ── App-level chrome ─────────────────────────────────────────────────────

    appchrome: {
      id: 'appchrome',
      label: 'App Header / Title Bar',
      type: 'panel',
      parent: null,
      visibility: 'Always visible. Height: 36px. Draggable for window movement.',
      children: ['appchrome_branding', 'appchrome_clock', 'appchrome_vpn', 'appchrome_minimize', 'appchrome_maximize', 'appchrome_close'],
    },

    appchrome_branding: {
      id: 'appchrome_branding',
      label: 'Branding — "CLAWDIA WORKSPACE"',
      type: 'section',
      parent: 'appchrome',
      visibility: 'Always visible. Left section of header.',
      notes: 'Non-interactive small-caps text label.',
    },

    appchrome_clock: {
      id: 'appchrome_clock',
      label: 'Live Clock',
      type: 'section',
      parent: 'appchrome',
      visibility: 'Always visible. Center of header. Updates every second.',
      notes: 'Displays day of week, month, date, and time.',
    },

    appchrome_vpn: {
      id: 'appchrome_vpn',
      label: 'VPN Toggle Button',
      type: 'button',
      parent: 'appchrome',
      visibility: 'Always visible. Right section of header.',
      action: 'Toggles WireGuard VPN on/off.',
      states: ['connected (green dot)', 'disconnected (outline dot)', 'busy/toggling (shows "···")'],
    },

    appchrome_minimize: {
      id: 'appchrome_minimize',
      label: 'Minimize Window',
      type: 'button',
      parent: 'appchrome',
      visibility: 'Always visible. Far right of header.',
      action: 'Calls window.minimize() — hides app to taskbar.',
    },

    appchrome_maximize: {
      id: 'appchrome_maximize',
      label: 'Maximize / Restore Window',
      type: 'button',
      parent: 'appchrome',
      visibility: 'Always visible.',
      action: 'Calls window.maximize() — toggles full-screen.',
    },

    appchrome_close: {
      id: 'appchrome_close',
      label: 'Close Window',
      type: 'button',
      parent: 'appchrome',
      visibility: 'Always visible. Turns red on hover.',
      action: 'Calls window.close() — quits the application.',
    },

    // ── Tab strip ────────────────────────────────────────────────────────────

    tabstrip: {
      id: 'tabstrip',
      label: 'Conversation Tab Strip',
      type: 'panel',
      parent: 'left_pane',
      visibility: 'Always visible in left pane. Height: 46px.',
      children: ['tabstrip_tabs', 'tabstrip_new_button'],
      notes: 'Tabs correspond to independent conversation contexts. Multiple agents can run in parallel across tabs.',
    },

    tabstrip_tabs: {
      id: 'tabstrip_tabs',
      label: 'Conversation Tabs',
      type: 'tab',
      parent: 'tabstrip',
      visibility: 'Always visible. Each conversation tab shows title (or "Chat N" if untitled), close × button, and a pulsing dot if an agent is running in a background conversation tab.',
      action: 'Click a conversation tab to switch the active conversation. Click × to close that conversation tab (minimum 1 conversation tab always open).',
      states: ['active (bright, subtle background)', 'inactive (dimmed, transparent)', 'running-background (pulsing dot indicator)'],
    },

    tabstrip_new_button: {
      id: 'tabstrip_new_button',
      label: 'New Conversation Tab Button (+)',
      type: 'button',
      parent: 'tabstrip',
      visibility: 'Always visible. Rightmost element in tab strip.',
      action: 'Creates a new conversation tab via api.chat.create().',
    },

    // ── Left pane views ──────────────────────────────────────────────────────

    chat_messages: {
      id: 'chat_messages',
      label: 'Chat Message List',
      type: 'section',
      parent: 'view_chat',
      visibility: 'Visible when activeView === "chat" and historyMode is false.',
      children: ['chat_empty_state', 'chat_message_user', 'chat_message_assistant', 'approval_banner', 'human_intervention_banner'],
      notes: 'Scrollable. Auto-scrolls to bottom during streaming. Shows zoom controls in top-right corner.',
    },

    chat_empty_state: {
      id: 'chat_empty_state',
      label: 'Empty Chat State',
      type: 'section',
      parent: 'chat_messages',
      visibility: 'Visible when chat has no messages. Shows different content for each conversation mode: ClawdiaEmptyState (default chat), CodexEmptyState (codex_terminal), ClaudeCodeEmptyState (claude_terminal).',
      action: 'Contains quick-action prompt chips. Clicking a chip calls onSend(promptText).',
    },

    chat_message_user: {
      id: 'chat_message_user',
      label: 'User Message Bubble',
      type: 'section',
      parent: 'chat_messages',
      visibility: 'One per user message in the conversation.',
      action: 'Hover shows retry button. Retry re-sends the message.',
    },

    chat_message_assistant: {
      id: 'chat_message_assistant',
      label: 'Assistant Message',
      type: 'section',
      parent: 'chat_messages',
      visibility: 'One per assistant turn. May contain text, tool activity cards, thinking blocks.',
      children: ['tool_activity_card'],
      notes: 'Markdown rendered. Code blocks have copy buttons.',
    },

    tool_activity_card: {
      id: 'tool_activity_card',
      label: 'Tool Activity Card',
      type: 'section',
      parent: 'chat_message_assistant',
      visibility: 'Shown inside an assistant message turn for each tool called.',
      states: ['running (pulsing)', 'success (green)', 'error (red)'],
      notes: 'Expandable IN/OUT sections. Shows tool name, duration, input args, and output. Friendly names: shell_exec→Bash, file_edit→Edit, browser_click→Click, gui_interact→GUI, memory_store→Memory.',
    },

    chat_toolbar: {
      id: 'chat_toolbar',
      label: 'Chat Toolbar',
      type: 'panel',
      parent: 'view_chat',
      visibility: 'Visible in top-right of the chat message area.',
      children: ['chat_zoom_minus', 'chat_zoom_display', 'chat_zoom_plus', 'chat_history_button', 'chat_terminal_button', 'chat_settings_button'],
    },

    chat_zoom_minus: {
      id: 'chat_zoom_minus',
      label: 'Zoom Out (−)',
      type: 'button',
      parent: 'chat_toolbar',
      visibility: 'Always visible in chat toolbar.',
      action: 'Decreases chat message font/zoom level.',
    },

    chat_zoom_display: {
      id: 'chat_zoom_display',
      label: 'Zoom Level Display',
      type: 'button',
      parent: 'chat_toolbar',
      visibility: 'Always visible. Shows current zoom percentage (e.g. "100%").',
      action: 'Click resets zoom to 100%.',
    },

    chat_zoom_plus: {
      id: 'chat_zoom_plus',
      label: 'Zoom In (+)',
      type: 'button',
      parent: 'chat_toolbar',
      visibility: 'Always visible in chat toolbar.',
      action: 'Increases chat message font/zoom level.',
    },

    chat_history_button: {
      id: 'chat_history_button',
      label: 'History Toggle (clock icon)',
      type: 'button',
      parent: 'chat_toolbar',
      visibility: 'Always visible.',
      action: 'Toggles historyMode — shows/hides the conversation history browser inline.',
      shortcut: 'Ctrl+H',
      states: ['inactive', 'active (highlighted background)'],
    },

    chat_terminal_button: {
      id: 'chat_terminal_button',
      label: 'Terminal Toggle (terminal icon)',
      type: 'button',
      parent: 'chat_toolbar',
      visibility: 'Always visible.',
      action: 'Calls onToggleTerminal() — switches rightPaneMode between "terminal" and previous mode.',
    },

    chat_settings_button: {
      id: 'chat_settings_button',
      label: 'Settings Button (gear icon)',
      type: 'button',
      parent: 'chat_toolbar',
      visibility: 'Always visible.',
      action: 'Calls onOpenSettings() — switches activeView to "settings".',
      shortcut: 'Ctrl+,',
    },

    approval_banner: {
      id: 'approval_banner',
      label: 'Approval Banner',
      type: 'overlay',
      parent: 'chat_messages',
      visibility: 'Visible at top of message list when pendingApprovalRunId is set (agent needs user approval before continuing).',
      children: ['approval_button_approve', 'approval_button_deny', 'approval_button_review'],
      notes: 'Blocks agent execution until user responds. Shows summary and action type.',
    },

    approval_button_approve: {
      id: 'approval_button_approve',
      label: 'Approve Button',
      type: 'button',
      parent: 'approval_banner',
      visibility: 'Inside approval banner.',
      action: 'Calls onApprove() — allows agent to proceed.',
    },

    approval_button_deny: {
      id: 'approval_button_deny',
      label: 'Deny Button',
      type: 'button',
      parent: 'approval_banner',
      visibility: 'Inside approval banner.',
      action: 'Calls onDeny() — blocks agent action.',
    },

    approval_button_review: {
      id: 'approval_button_review',
      label: 'Open Review Button',
      type: 'button',
      parent: 'approval_banner',
      visibility: 'Inside approval banner.',
      action: 'Switches to ProcessesPanel for detailed review.',
    },

    human_intervention_banner: {
      id: 'human_intervention_banner',
      label: 'Human Intervention Banner',
      type: 'overlay',
      parent: 'chat_messages',
      visibility: 'Visible when agent has paused and explicitly requested a human to act (e.g. solve a CAPTCHA, log in manually).',
      states: ['pulsing animation'],
      children: ['intervention_button_resume', 'intervention_button_cancel', 'intervention_button_review'],
    },

    shimmer: {
      id: 'shimmer',
      label: 'Streaming Shimmer / Loading Indicator',
      type: 'overlay',
      parent: 'view_chat',
      visibility: 'Visible as a fixed-position element when isStreaming is true and the assistant is generating text.',
      notes: 'Shows animated shimmer text. Positioned above the InputBar.',
    },

    prompt_debug_panel: {
      id: 'prompt_debug_panel',
      label: 'Prompt Debug Panel',
      type: 'overlay',
      parent: 'view_chat',
      visibility: 'Visible when promptDebugOpen is true. Fixed position bottom-right (520px wide). Toggle button always present.',
      notes: 'Shows full system prompt, tool list, message array, provider, model, iteration count. For developer/debugging use.',
    },

    // ── InputBar ─────────────────────────────────────────────────────────────

    inputbar: {
      id: 'inputbar',
      label: 'Message Input Bar',
      type: 'panel',
      parent: 'view_chat',
      visibility: 'Always visible at the bottom of the chat view.',
      children: ['inputbar_model_selector', 'inputbar_claude_code_toggle', 'inputbar_codex_toggle', 'inputbar_attachments', 'inputbar_textarea', 'inputbar_attach_button', 'inputbar_send_button', 'inputbar_pause_button', 'inputbar_add_context_button', 'inputbar_stop_button'],
    },

    inputbar_model_selector: {
      id: 'inputbar_model_selector',
      label: 'Model Selector Dropdown',
      type: 'dropdown',
      parent: 'inputbar',
      visibility: 'Always visible in InputBar left section.',
      action: 'Opens/closes model selection dropdown. Grouped by provider. Selecting a model calls setProvider() and setModel().',
      states: ['closed', 'open (floats above input bar)'],
      notes: 'Dropdown appears above the input bar (bottom-full). Shows provider name headers and individual model rows with tier badges.',
    },

    inputbar_claude_code_toggle: {
      id: 'inputbar_claude_code_toggle',
      label: 'Claude Code Mode Toggle (<> icon)',
      type: 'toggle',
      parent: 'inputbar',
      visibility: 'Visible when not streaming.',
      action: 'Calls onToggleClaudeMode(). Switches conversation to claude_terminal mode (runs Claude Code CLI in the terminal pane).',
      states: ['inactive (muted)', 'active (amber, highlighted)', 'disabled (very muted, shows tooltip "Create conversation first")'],
    },

    inputbar_codex_toggle: {
      id: 'inputbar_codex_toggle',
      label: 'Codex Mode Toggle (monitor icon)',
      type: 'toggle',
      parent: 'inputbar',
      visibility: 'Visible when not streaming.',
      action: 'Calls onToggleCodexMode(). Switches conversation to codex_terminal mode.',
      states: ['inactive (muted)', 'active (emerald, highlighted)', 'disabled'],
    },

    inputbar_attachments: {
      id: 'inputbar_attachments',
      label: 'Attachment Chips',
      type: 'section',
      parent: 'inputbar',
      visibility: 'Visible when attachments.length > 0.',
      notes: 'Grid of chips. Images show thumbnail (92px tall). Files show name+size. Each has an × remove button.',
    },

    inputbar_textarea: {
      id: 'inputbar_textarea',
      label: 'Message Textarea',
      type: 'input',
      parent: 'inputbar',
      visibility: 'Always visible.',
      action: 'User types message here. Enter sends. Shift+Enter inserts newline. Escape stops streaming.',
      states: ['empty (placeholder: "Ask me anything...")', 'streaming (placeholder: "Queue another message...", grayed)', 'focused (highlighted border)'],
      notes: 'Auto-grows up to 200px height. Font size: 21px.',
    },

    inputbar_attach_button: {
      id: 'inputbar_attach_button',
      label: 'Attach File Button (paperclip icon)',
      type: 'button',
      parent: 'inputbar',
      visibility: 'Always visible. Disabled during streaming.',
      action: 'Opens file picker. Accepts images, PDFs, text, code, CSV, Office docs, ZIP.',
    },

    inputbar_send_button: {
      id: 'inputbar_send_button',
      label: 'Send Button (arrow icon)',
      type: 'button',
      parent: 'inputbar',
      visibility: 'Visible when NOT streaming.',
      action: 'Sends the message. Disabled if textarea is empty and no attachments.',
      states: ['enabled (white circle with dark arrow)', 'disabled (translucent)'],
    },

    inputbar_pause_button: {
      id: 'inputbar_pause_button',
      label: 'Pause / Resume Button',
      type: 'button',
      parent: 'inputbar',
      visibility: 'Visible when streaming.',
      action: 'Pauses the streaming response (onPause) or resumes it (onResume).',
      states: ['pause mode (blue icon)', 'paused mode (amber icon, shows play triangle)'],
    },

    inputbar_add_context_button: {
      id: 'inputbar_add_context_button',
      label: 'Add Context Button (+ icon)',
      type: 'button',
      parent: 'inputbar',
      visibility: 'Visible when streaming AND textarea has content.',
      action: 'Injects additional context into the running agent without stopping it.',
    },

    inputbar_stop_button: {
      id: 'inputbar_stop_button',
      label: 'Stop Button (square icon)',
      type: 'button',
      parent: 'inputbar',
      visibility: 'Visible when streaming.',
      action: 'Calls onStop() — cancels the current agent run immediately.',
      states: ['red icon'],
    },

    // ── Right pane panels ────────────────────────────────────────────────────

    browser_panel: {
      id: 'browser_panel',
      label: 'Browser Panel',
      type: 'panel',
      parent: 'right_pane',
      visibility: 'Visible when rightPaneMode === "browser". Occupies 65% of window width.',
      children: ['browser_url_bar', 'browser_tab_strip', 'browser_viewport'],
    },

    browser_url_bar: {
      id: 'browser_url_bar',
      label: 'Browser URL Bar',
      type: 'input',
      parent: 'browser_panel',
      visibility: 'Always visible when browser panel is open.',
      action: 'Enter a URL or search query. Resolves to: HTTPS URL, localhost URL, IP address, or Google search.',
      notes: 'Ghost text shows autocomplete from history. displayUrl() strips https:// and www. prefix for display.',
    },

    browser_tab_strip: {
      id: 'browser_tab_strip',
      label: 'Browser Tab Strip',
      type: 'panel',
      parent: 'browser_panel',
      visibility: 'Visible when browser panel is open and browser tabs exist.',
      notes: 'Separate from the conversation TabStrip. These are web browser tabs within the embedded Chromium.',
      action: 'Click a browser tab to switch. Click × to close that browser tab. Shows favicon and page title.',
    },

    browser_viewport: {
      id: 'browser_viewport',
      label: 'Browser Viewport',
      type: 'panel',
      parent: 'browser_panel',
      visibility: 'Always present when browser panel is open. The actual rendered web content.',
      notes: 'Native Electron BrowserView. Bounds synced to DOM element via ResizeObserver. Not a React element — controlled via IPC.',
    },

    terminal_panel: {
      id: 'terminal_panel',
      label: 'Terminal Panel',
      type: 'panel',
      parent: 'right_pane',
      visibility: 'Visible when rightPaneMode === "terminal".',
      children: ['terminal_toolbar', 'terminal_xterm'],
    },

    terminal_toolbar: {
      id: 'terminal_toolbar',
      label: 'Terminal Toolbar',
      type: 'panel',
      parent: 'terminal_panel',
      visibility: 'Always visible when terminal panel is open.',
      children: ['terminal_font_minus', 'terminal_font_size_display', 'terminal_font_plus', 'terminal_copy', 'terminal_paste', 'terminal_close'],
    },

    terminal_font_minus: {
      id: 'terminal_font_minus',
      label: 'Terminal Font Size Decrease (−)',
      type: 'button',
      parent: 'terminal_toolbar',
      visibility: 'Always visible in terminal toolbar.',
      action: 'Decreases terminal font size. Min: 10px.',
    },

    terminal_font_size_display: {
      id: 'terminal_font_size_display',
      label: 'Terminal Font Size Display',
      type: 'section',
      parent: 'terminal_toolbar',
      visibility: 'Shows current font size (default 13px).',
    },

    terminal_font_plus: {
      id: 'terminal_font_plus',
      label: 'Terminal Font Size Increase (+)',
      type: 'button',
      parent: 'terminal_toolbar',
      visibility: 'Always visible in terminal toolbar.',
      action: 'Increases terminal font size. Max: 24px.',
    },

    terminal_copy: {
      id: 'terminal_copy',
      label: 'Terminal Copy Button',
      type: 'button',
      parent: 'terminal_toolbar',
      visibility: 'Always visible in terminal toolbar.',
      action: 'Copies selected text from terminal to clipboard.',
    },

    terminal_paste: {
      id: 'terminal_paste',
      label: 'Terminal Paste Button',
      type: 'button',
      parent: 'terminal_toolbar',
      visibility: 'Always visible in terminal toolbar.',
      action: 'Pastes clipboard content into terminal.',
    },

    terminal_xterm: {
      id: 'terminal_xterm',
      label: 'xterm.js Terminal Emulator',
      type: 'panel',
      parent: 'terminal_panel',
      visibility: 'Always present when terminal panel is open.',
      notes: 'Full PTY-backed terminal. Dark theme. Supports full ANSI colors and standard terminal interactions.',
    },

    editor_panel: {
      id: 'editor_panel',
      label: 'Editor Panel',
      type: 'panel',
      parent: 'right_pane',
      visibility: 'Visible when rightPaneMode === "editor".',
      notes: 'Code editor with multi-file tab support. Each editor tab has: id, filePath. Dirty state tracked per editor tab.',
    },

    // ── Conversations view ────────────────────────────────────────────────────

    conversations_list: {
      id: 'conversations_list',
      label: 'Conversations History List',
      type: 'panel',
      parent: 'view_conversations',
      visibility: 'Visible when activeView === "conversations".',
      action: 'Click any conversation row to load it into the active conversation tab.',
    },

    // ── Settings view ─────────────────────────────────────────────────────────

    settings_form: {
      id: 'settings_form',
      label: 'Settings Form',
      type: 'panel',
      parent: 'view_settings',
      visibility: 'Visible when activeView === "settings".',
      notes: 'Contains: API key fields per provider, model selectors, unrestricted mode toggle, policy profile selector, performance stance selector.',
    },

    // ── Processes view ────────────────────────────────────────────────────────

    processes_list: {
      id: 'processes_list',
      label: 'Processes / Runs List',
      type: 'panel',
      parent: 'view_processes',
      visibility: 'Visible when activeView === "processes".',
      notes: 'Lists all runs with status, model, timestamps. Click a run to see events, artifacts, tool calls, and approval details.',
    },
  },
};

// ── Query helpers ─────────────────────────────────────────────────────────────

/** Return all elements whose visibility is relevant to a given rightPaneMode and activeView */
export function getVisibleElements(
  activeView: string,
  rightPaneMode: string,
): UIElement[] {
  const visible: UIElement[] = [];
  for (const el of Object.values(CLAWDIA_UI_MAP.elements)) {
    // Always-visible elements
    if (
      el.id.startsWith('appchrome') ||
      el.id === 'tabstrip' ||
      el.id === 'tabstrip_tabs' ||
      el.id === 'tabstrip_new_button'
    ) {
      visible.push(el);
      continue;
    }

    // View-specific elements
    if (activeView === 'chat' && (
      el.parent === 'view_chat' ||
      el.parent === 'chat_messages' ||
      el.parent === 'chat_toolbar' ||
      el.parent === 'inputbar' ||
      el.parent === 'chat_message_assistant' ||
      el.parent === 'approval_banner' ||
      el.id === 'inputbar'
    )) {
      visible.push(el);
      continue;
    }

    if (activeView === 'conversations' && el.parent === 'view_conversations') {
      visible.push(el);
      continue;
    }

    if (activeView === 'settings' && el.parent === 'view_settings') {
      visible.push(el);
      continue;
    }

    if (activeView === 'processes' && el.parent === 'view_processes') {
      visible.push(el);
      continue;
    }

    // Right pane elements
    if (rightPaneMode === 'browser' && (
      el.parent === 'browser_panel' || el.id === 'browser_panel'
    )) {
      visible.push(el);
      continue;
    }

    if (rightPaneMode === 'terminal' && (
      el.parent === 'terminal_panel' ||
      el.parent === 'terminal_toolbar' ||
      el.id === 'terminal_panel'
    )) {
      visible.push(el);
      continue;
    }

    if (rightPaneMode === 'editor' && (
      el.id === 'editor_panel'
    )) {
      visible.push(el);
      continue;
    }
  }
  return visible;
}

/** Get a single element by ID */
export function getElement(id: string): UIElement | undefined {
  return CLAWDIA_UI_MAP.elements[id];
}

/** Get all children of an element */
export function getChildren(parentId: string): UIElement[] {
  return Object.values(CLAWDIA_UI_MAP.elements).filter(el => el.parent === parentId);
}

/** Find elements by type */
export function getElementsByType(type: UIElement['type']): UIElement[] {
  return Object.values(CLAWDIA_UI_MAP.elements).filter(el => el.type === type);
}
