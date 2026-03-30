/**
 * AT-SPI accessibility tree integration.
 *
 * Uses Python3 + gi (GObject Introspection) to query the AT-SPI2 accessibility
 * bus. Same approach as 4.0 but with inline Python scripts instead of external
 * .py files — no resource bundling required.
 *
 * AT-SPI is the gold standard for Linux GUI automation:
 * - Works on Wayland (unlike xdotool)
 * - Addresses elements by role+name (reliable, no pixel-coordinate dependency)
 * - Can read/write values (text fields, sliders, checkboxes)
 * - Can trigger actions (click, press, focus) without synthesising mouse events
 */
import { runSeparate } from './shared';

// ─── Python helper ────────────────────────────────────────────────────────────

async function pyA11y(script: string): Promise<{ ok: boolean; data: any; error?: string }> {
    const escaped = script.replace(/'/g, "'\\''");
    const { stdout, stderr } = await runSeparate(
        `python3 -c '${escaped}' 2>/dev/null`,
        10_000,
    );

    if (!stdout && stderr) {
        return { ok: false, data: null, error: stderr.slice(0, 300) };
    }

    try {
        const data = JSON.parse(stdout || '{}');
        if (data.error) return { ok: false, data, error: data.error };
        return { ok: true, data };
    } catch {
        return { ok: false, data: null, error: `Non-JSON output: ${stdout.slice(0, 200)}` };
    }
}

// ─── Availability check ───────────────────────────────────────────────────────

let _a11yAvailable: boolean | null = null;

export async function isA11yAvailable(): Promise<boolean> {
    if (_a11yAvailable !== null) return _a11yAvailable;
    const { ok } = await pyA11y(
        "import gi; gi.require_version('Atspi','2.0'); from gi.repository import Atspi; print('{}') ",
    );
    _a11yAvailable = ok;
    return ok;
}

// ─── a11y_list_apps ───────────────────────────────────────────────────────────

const LIST_APPS_PY = `
import gi, json
gi.require_version('Atspi', '2.0')
from gi.repository import Atspi
desktop = Atspi.get_desktop(0)
apps = []
for i in range(desktop.get_child_count()):
  child = desktop.get_child_at_index(i)
  if child:
    try: apps.append(child.get_name())
    except: pass
print(json.dumps({'apps': apps}))
`.trim();

export async function a11yListApps(): Promise<{ apps?: string[]; error?: string }> {
    const { ok, data, error } = await pyA11y(LIST_APPS_PY);
    return ok ? data : { error };
}

// ─── a11y_get_tree ────────────────────────────────────────────────────────────

function buildTreePy(appName: string, scope: string | undefined, maxDepth: number): string {
    return `
import gi, json
gi.require_version('Atspi', '2.0')
from gi.repository import Atspi
desktop = Atspi.get_desktop(0)
target = None
for i in range(desktop.get_child_count()):
  child = desktop.get_child_at_index(i)
  if child and child.get_name().lower().startswith(${JSON.stringify(appName.toLowerCase())}):
    target = child
    break
if not target:
  print(json.dumps({'error': 'App not found: ${appName}', 'available_apps': [desktop.get_child_at_index(i).get_name() for i in range(desktop.get_child_count()) if desktop.get_child_at_index(i)]}))
else:
  def build(node, depth):
    if depth > ${maxDepth}: return None
    try:
      role = node.get_role_name()
      name = node.get_name() or ''
      state = [s for s in ['focusable','focused','editable','visible','enabled','checked','selected'] if getattr(node.get_state_set(), 'contains', lambda x: False)(getattr(Atspi.StateType, s.upper(), None))]
      kids = []
      for i in range(min(node.get_child_count(), 40)):
        c = node.get_child_at_index(i)
        if c:
          sub = build(c, depth+1)
          if sub: kids.append(sub)
      result = {'role': role, 'name': name}
      if state: result['state'] = state
      if kids: result['children'] = kids
      return result
    except: return None
  print(json.dumps({'tree': build(target, 0)}))
`.trim();
}

export async function a11yGetTree(
    appName: string,
    scope?: string,
    depth = 4,
): Promise<{ tree?: any; error?: string; available_apps?: string[] }> {
    const { ok, data, error } = await pyA11y(buildTreePy(appName, scope, Math.min(depth, 6)));
    return ok ? data : { error };
}

// ─── a11y_find ────────────────────────────────────────────────────────────────

function buildFindPy(appName: string, role: string, name: string): string {
    return `
import gi, json
gi.require_version('Atspi', '2.0')
from gi.repository import Atspi
desktop = Atspi.get_desktop(0)
target_app = None
for i in range(desktop.get_child_count()):
  child = desktop.get_child_at_index(i)
  if child and child.get_name().lower().startswith(${JSON.stringify(appName.toLowerCase())}):
    target_app = child
    break
if not target_app:
  print(json.dumps({'found': False, 'error': 'App not found: ${appName}'}))
else:
  def search(node, depth=0):
    if depth > 8: return []
    results = []
    try:
      r = node.get_role_name()
      n = node.get_name() or ''
      if r.lower() == ${JSON.stringify(role.toLowerCase())} and ${JSON.stringify(name.toLowerCase())} in n.lower():
        try: actions = [node.get_action_name(i) for i in range(node.get_n_actions())]
        except: actions = []
        results.append({'role': r, 'name': n, 'actions': actions})
      for i in range(min(node.get_child_count(), 60)):
        c = node.get_child_at_index(i)
        if c: results.extend(search(c, depth+1))
    except: pass
    return results
  matches = search(target_app)
  if not matches:
    print(json.dumps({'found': False}))
  elif len(matches) == 1:
    print(json.dumps({'found': True, 'match': matches[0]}))
  else:
    print(json.dumps({'found': True, 'ambiguous': True, 'candidates': len(matches), 'top_matches': matches[:5]}))
`.trim();
}

export async function a11yFind(
    appName: string,
    role: string,
    name: string,
): Promise<{ found?: boolean; match?: any; ambiguous?: boolean; candidates?: number; top_matches?: any[]; error?: string }> {
    const { ok, data, error } = await pyA11y(buildFindPy(appName, role, name));
    return ok ? data : { error };
}

// ─── a11y_do_action ──────────────────────────────────────────────────────────

function buildDoActionPy(appName: string, role: string, name: string, action: string): string {
    return `
import gi, json
gi.require_version('Atspi', '2.0')
from gi.repository import Atspi
desktop = Atspi.get_desktop(0)
target_app = None
for i in range(desktop.get_child_count()):
  child = desktop.get_child_at_index(i)
  if child and child.get_name().lower().startswith(${JSON.stringify(appName.toLowerCase())}):
    target_app = child
    break
if not target_app:
  print(json.dumps({'error': 'App not found: ${appName}', 'success': False}))
else:
  def find_and_act(node, depth=0):
    if depth > 8: return None
    try:
      if node.get_role_name().lower() == ${JSON.stringify(role.toLowerCase())} and ${JSON.stringify(name.toLowerCase())} in (node.get_name() or '').lower():
        try:
          n_actions = node.get_n_actions()
          available = [node.get_action_name(i) for i in range(n_actions)]
          for i in range(n_actions):
            if node.get_action_name(i).lower() == ${JSON.stringify(action.toLowerCase())}:
              node.do_action(i)
              return json.dumps({'success': True, 'action': ${JSON.stringify(action)}, 'available_actions': available})
          return json.dumps({'success': False, 'error': 'Action not found', 'available_actions': available})
        except Exception as e:
          return json.dumps({'success': False, 'error': str(e)})
      for i in range(min(node.get_child_count(), 60)):
        c = node.get_child_at_index(i)
        if c:
          r = find_and_act(c, depth+1)
          if r: return r
    except: pass
    return None
  result = find_and_act(target_app)
  print(result or json.dumps({'success': False, 'error': 'Element not found'}))
`.trim();
}

export async function a11yDoAction(
    appName: string,
    role: string,
    name: string,
    action: string,
): Promise<{ success?: boolean; action?: string; error?: string; available_actions?: string[] }> {
    const { ok, data, error } = await pyA11y(buildDoActionPy(appName, role, name, action));
    return ok ? data : { error };
}

// ─── a11y_set_value ───────────────────────────────────────────────────────────

function buildSetValuePy(appName: string, role: string, name: string, value: string): string {
    return `
import gi, json
gi.require_version('Atspi', '2.0')
from gi.repository import Atspi
desktop = Atspi.get_desktop(0)
target_app = None
for i in range(desktop.get_child_count()):
  child = desktop.get_child_at_index(i)
  if child and child.get_name().lower().startswith(${JSON.stringify(appName.toLowerCase())}):
    target_app = child
    break
if not target_app:
  print(json.dumps({'error': 'App not found: ${appName}'}))
else:
  def find_and_set(node, depth=0):
    if depth > 8: return None
    try:
      if node.get_role_name().lower() == ${JSON.stringify(role.toLowerCase())} and ${JSON.stringify(name.toLowerCase())} in (node.get_name() or '').lower():
        try:
          iface = node.get_action_iface()
          text_iface = node.get_text_iface()
          if text_iface:
            node.do_action(0)  # focus
            text_iface.set_text_contents(${JSON.stringify(value)})
            readback = text_iface.get_text(0, -1)
            return json.dumps({'value_set': ${JSON.stringify(value)}, 'value_read_back': readback})
        except Exception as e:
          return json.dumps({'error': str(e)})
      for i in range(min(node.get_child_count(), 60)):
        c = node.get_child_at_index(i)
        if c:
          r = find_and_set(c, depth+1)
          if r: return r
    except: pass
    return None
  result = find_and_set(target_app)
  print(result or json.dumps({'error': 'Element not found'}))
`.trim();
}

export async function a11ySetValue(
    appName: string,
    role: string,
    name: string,
    value: string,
): Promise<{ value_set?: string; value_read_back?: string; error?: string }> {
    const { ok, data, error } = await pyA11y(buildSetValuePy(appName, role, name, value));
    return ok ? data : { error };
}
