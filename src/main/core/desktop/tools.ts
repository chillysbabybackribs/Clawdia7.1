/**
 * Desktop tool schemas — exposed to all LLM providers via the tool registry.
 *
 * Tools:
 *   gui_interact  — all X11/Wayland/AT-SPI GUI automation
 *   dbus_control  — DBus session bus control
 */
import type Anthropic from '@anthropic-ai/sdk';

export const DESKTOP_TOOLS: Anthropic.Tool[] = [
    {
        name: 'gui_interact',
        description:
            'Interact with native desktop GUI applications on Linux. Supports: click, type, key, right_click, double_click, scroll, focus, find_window, list_windows, window_geometry, screenshot, screenshot_region, maximize_window, fullscreen_window, attach_window, close_window, app_launch, open_menu_path, fill_dialog, click_and_type, export_file, validate_menu_bar, a11y_get_tree, a11y_find, a11y_do_action, a11y_set_value, a11y_list_apps, batch_actions, gui_query (see available actions and capabilities), verify_window_title, verify_file_exists, wait. On Wayland, prefer a11y_* actions. Call gui_query first to see what tools are available.',
        input_schema: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    description:
                        'Action to perform. Primitives: click|type|key|right_click|double_click|scroll|focus|find_window|list_windows|window_geometry|screenshot|screenshot_region|maximize_window|fullscreen_window|verify_window_title|verify_file_exists|attach_window|close_window|wait. Macros: app_launch|open_menu_path|fill_dialog|click_and_type|export_file|validate_menu_bar. Accessibility: a11y_get_tree|a11y_find|a11y_do_action|a11y_set_value|a11y_list_apps. Special: batch_actions|dbus_control|gui_query. USE attach_window (not app_launch) when an app is already open or was opened via shell/xdg-open. attach_window automatically records window position and monitor. USE window_geometry to query position/monitor without changing focus. USE close_window to dismiss/close any app window. On DUAL MONITOR setups, pass "monitor" (0-based index) with app_launch or attach_window to select the correct window when multiple same-titled windows are open.',
                },
                window: { type: 'string', description: 'Window title (partial match). Required for click/type/key/focus/attach_window/close_window/macros. Not needed for list_windows or screenshot (full screen).' },
                x: { type: 'number', description: 'Screen X coordinate.' },
                y: { type: 'number', description: 'Screen Y coordinate.' },
                text: { type: 'string', description: 'Text to type, key combo (e.g. "ctrl+s"), path, or label.' },
                delay: { type: 'number', description: 'Delay in ms before executing the action.' },
                verify: { type: 'boolean', description: 'Force post-action OCR verification on/off.' },
                // Region screenshot
                rx: { type: 'number', description: 'Region x (for screenshot_region).' },
                ry: { type: 'number', description: 'Region y.' },
                rw: { type: 'number', description: 'Region width.' },
                rh: { type: 'number', description: 'Region height.' },
                // Macro fields
                app: { type: 'string', description: 'App binary name (for app_launch).' },
                path: { type: 'string', description: 'Menu path ("File > Export As") or file path.' },
                shortcut: { type: 'string', description: 'Keyboard shortcut to trigger export dialog (default: ctrl+shift+e).' },
                confirm: { type: 'boolean', description: 'Whether to press Enter to confirm fill_dialog (default: true).' },
                fields: {
                    type: 'array',
                    description: 'Form fields for fill_dialog — array of {value, label?} in tab order.',
                    items: {
                        type: 'object',
                        properties: {
                            value: { type: 'string' },
                            label: { type: 'string' },
                        },
                        required: ['value'],
                    },
                },
                menus: {
                    type: 'array',
                    description: 'Menu definitions for validate_menu_bar — array of {label, x, y}.',
                    items: {
                        type: 'object',
                        properties: {
                            label: { type: 'string' },
                            x: { type: 'number' },
                            y: { type: 'number' },
                        },
                        required: ['label', 'x', 'y'],
                    },
                },
                // AT-SPI fields
                role: { type: 'string', description: 'AT-SPI accessibility role (e.g. "push button", "text", "check box").' },
                name: { type: 'string', description: 'AT-SPI element name (label or accessible name).' },
                a11y_action: { type: 'string', description: 'AT-SPI action to invoke (e.g. "click", "press", "activate").' },
                value: { type: 'string', description: 'Value to set (for a11y_set_value).' },
                depth: { type: 'number', description: 'Max depth for a11y_get_tree (default: 4, max: 6).' },
                // Batch mode
                actions: {
                    type: 'array',
                    description: 'Steps for batch_actions — array of action objects (max 25).',
                    items: { type: 'object', properties: { action: { type: 'string' } }, required: ['action'] },
                },
                // DBus fields
                service: { type: 'string', description: 'DBus service name (e.g. "org.mpris.MediaPlayer2.spotify").' },
                interface: { type: 'string', description: 'DBus interface name.' },
                method: { type: 'string', description: 'DBus method or property name.' },
                args: { type: 'array', items: { type: 'string' }, description: 'DBus call arguments.' },
                // Scroll direction
                direction: { type: 'string', description: 'Scroll direction: up|down|left|right (default: down).' },
                amount: { type: 'number', description: 'Scroll click count (default: 3).' },
                // close_window
                force: { type: 'boolean', description: 'For close_window: if true, sends SIGTERM to the owning PID after WM close fails.' },
                // Multi-monitor disambiguation
                monitor: { type: 'number', description: 'Preferred monitor index (0-based) for app_launch and attach_window. When multiple windows match the title pattern (e.g. two terminals on different monitors), the window on this monitor is selected. Use window_geometry or list_windows to discover monitor indices.' },
            },
            required: ['action'],
        },
    },
];

export const DESKTOP_TOOL_NAMES = new Set(DESKTOP_TOOLS.map((t) => t.name));
