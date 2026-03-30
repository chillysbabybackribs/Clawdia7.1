import type { PolicyProfile } from '../../shared/types';

// ─── Row shape ──────────────────────────────────────────────────────────────

interface PolicyProfileRow {
    id: string;
    name: string;
    scope_type: 'global' | 'workspace' | 'task_type';
    scope_value: string | null;
    rules_json: string;
    created_at: string;
    updated_at: string;
}

// ─── Default profiles ────────────────────────────────────────────────────────

const DEFAULT_PROFILES: PolicyProfile[] = [
    {
        id: 'standard',
        name: 'Standard',
        scopeType: 'global',
        rules: [
            {
                id: 'std-git-push',
                enabled: true,
                match: { toolNames: ['shell_exec'], commandPatterns: ['\\bgit\\s+push\\b'] },
                effect: 'require_approval',
                reason: 'External side effect: pushing commits.',
            },
            {
                id: 'std-sudo',
                enabled: true,
                match: { toolNames: ['shell_exec'], commandPatterns: ['\\bsudo\\b'] },
                effect: 'require_approval',
                reason: 'Privileged command requires explicit approval.',
            },
            {
                id: 'std-rm-rf',
                enabled: true,
                match: { toolNames: ['shell_exec'], commandPatterns: ['\\brm\\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|--recursive)[\\s/]'] },
                effect: 'require_approval',
                reason: 'Recursive delete is irreversible.',
            },
            {
                id: 'std-sensitive-files',
                enabled: true,
                match: { toolNames: ['file_write', 'file_edit'], pathPrefixes: ['.env', '.npmrc', '.git/config', '.ssh/', '/etc/'] },
                effect: 'require_approval',
                reason: 'Sensitive config files require approval before editing.',
            },
        ],
        createdAt: '',
        updatedAt: '',
    },
    {
        id: 'coding',
        name: 'Coding Review',
        scopeType: 'global',
        rules: [
            {
                id: 'coding-git-push',
                enabled: true,
                match: { toolNames: ['shell_exec'], commandPatterns: ['\\bgit\\s+push\\b'] },
                effect: 'require_approval',
                reason: 'Pushing code should stay user-approved.',
            },
            {
                id: 'coding-git-force',
                enabled: true,
                match: { toolNames: ['shell_exec'], commandPatterns: ['\\bgit\\s+push\\s+.*--force\\b|\\bgit\\s+push\\s+.*-f\\b'] },
                effect: 'deny',
                reason: 'Force-pushing is blocked in coding mode.',
            },
            {
                id: 'coding-pkg-install',
                enabled: true,
                match: { toolNames: ['shell_exec'], commandPatterns: ['\\b(?:npm|pnpm|yarn|bun)\\s+(?:install|add|i)\\b'] },
                effect: 'require_approval',
                reason: 'Dependency changes require review.',
            },
            {
                id: 'coding-apt',
                enabled: true,
                match: { toolNames: ['shell_exec'], commandPatterns: ['\\b(?:apt|apt-get|brew)\\s+(?:install|remove|upgrade)\\b'] },
                effect: 'require_approval',
                reason: 'System package changes require approval.',
            },
            {
                id: 'coding-drop-table',
                enabled: true,
                match: { toolNames: ['shell_exec'], commandPatterns: ['\\bDROP\\s+(?:TABLE|DATABASE)\\b'] },
                effect: 'deny',
                reason: 'Schema-destructive SQL is blocked in coding mode.',
            },
            {
                id: 'coding-sensitive-files',
                enabled: true,
                match: { toolNames: ['file_write', 'file_edit'], pathPrefixes: ['.env', '.env.', '.npmrc', '.git/config', '.ssh/', '/etc/'] },
                effect: 'require_approval',
                reason: 'Sensitive project and system config requires approval.',
            },
        ],
        createdAt: '',
        updatedAt: '',
    },
    {
        id: 'browser',
        name: 'Browser Review',
        scopeType: 'global',
        rules: [
            {
                id: 'browser-submit',
                enabled: true,
                match: { toolNames: ['browser_click', 'browser_type'], commandPatterns: ['submit|purchase|checkout|publish|post|confirm|delete'] },
                effect: 'require_approval',
                reason: 'Potential external submission requires approval.',
            },
            {
                id: 'browser-account',
                enabled: true,
                match: { toolNames: ['browser_click', 'browser_type'], commandPatterns: ['billing|permission|account|settings|password|2fa|mfa'] },
                effect: 'require_approval',
                reason: 'Account-changing browser actions require approval.',
            },
            {
                id: 'browser-payment',
                enabled: true,
                match: { toolNames: ['browser_click', 'browser_type'], commandPatterns: ['pay|card|credit|cvv|expir'] },
                effect: 'require_approval',
                reason: 'Payment-related browser actions require explicit approval.',
            },
        ],
        createdAt: '',
        updatedAt: '',
    },
    {
        id: 'locked',
        name: 'Locked Down',
        scopeType: 'global',
        rules: [
            {
                id: 'locked-shell',
                enabled: true,
                match: { toolNames: ['shell_exec'] },
                effect: 'require_approval',
                reason: 'All shell commands require approval in locked-down mode.',
            },
            {
                id: 'locked-writes',
                enabled: true,
                match: { toolNames: ['file_write', 'file_edit'] },
                effect: 'require_approval',
                reason: 'All file mutations require approval in locked-down mode.',
            },
            {
                id: 'locked-browser-actions',
                enabled: true,
                match: { toolNames: ['browser_click', 'browser_type', 'browser_navigate'] },
                effect: 'require_approval',
                reason: 'All browser interactions require approval in locked-down mode.',
            },
        ],
        createdAt: '',
        updatedAt: '',
    },
    {
        id: 'paranoid',
        name: 'Paranoid (Read-Only)',
        scopeType: 'global',
        rules: [
            {
                id: 'paranoid-shell',
                enabled: true,
                match: { toolNames: ['shell_exec'] },
                effect: 'deny',
                reason: 'Shell execution is completely blocked in paranoid mode.',
            },
            {
                id: 'paranoid-writes',
                enabled: true,
                match: { toolNames: ['file_write', 'file_edit'] },
                effect: 'deny',
                reason: 'All file mutations are blocked in paranoid mode.',
            },
            {
                id: 'paranoid-browser-mut',
                enabled: true,
                match: { toolNames: ['browser_click', 'browser_type', 'browser_navigate'] },
                effect: 'deny',
                reason: 'Browser mutations blocked in paranoid mode.',
            },
        ],
        createdAt: '',
        updatedAt: '',
    },
];

// ─── DB access ───────────────────────────────────────────────────────────────
// We accept an injected db handle (same pattern as memory.ts) rather than
// importing a getDb() singleton — avoids circular deps.

let _db: import('better-sqlite3').Database | null = null;

export function initPolicies(db: import('better-sqlite3').Database): void {
    _db = db;

    db.exec(`
    CREATE TABLE IF NOT EXISTS policy_profiles (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      scope_type  TEXT NOT NULL DEFAULT 'global',
      scope_value TEXT,
      rules_json  TEXT NOT NULL DEFAULT '[]',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS policy_audit_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id      TEXT,
      tool_name   TEXT NOT NULL,
      tool_input  TEXT NOT NULL,
      profile_id  TEXT NOT NULL,
      rule_id     TEXT,
      effect      TEXT NOT NULL,
      reason      TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_policy_audit_run ON policy_audit_log(run_id, created_at);
  `);

    seedPolicyProfiles(db);
}

function getDb(): import('better-sqlite3').Database {
    if (!_db) throw new Error('[policies] DB not initialised — call initPolicies() first');
    return _db;
}

// ─── Seed ────────────────────────────────────────────────────────────────────

function seedPolicyProfiles(db: import('better-sqlite3').Database): void {
    const insert = db.prepare(`
    INSERT OR IGNORE INTO policy_profiles
      (id, name, scope_type, scope_value, rules_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

    const now = new Date().toISOString();
    const tx = db.transaction(() => {
        for (const profile of DEFAULT_PROFILES) {
            insert.run(
                profile.id,
                profile.name,
                profile.scopeType,
                profile.scopeValue ?? null,
                JSON.stringify(profile.rules),
                now,
                now,
            );
        }
    });
    tx();
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export function listPolicyProfiles(): PolicyProfile[] {
    try {
        return getDb()
            .prepare('SELECT * FROM policy_profiles ORDER BY name ASC')
            .all()
            .map((row) => toPolicyProfile(row as PolicyProfileRow));
    } catch (err) {
        console.error('[policies] listPolicyProfiles failed:', err);
        return [];
    }
}

export function getPolicyProfile(id: string): PolicyProfile | null {
    try {
        const row = getDb()
            .prepare('SELECT * FROM policy_profiles WHERE id = ?')
            .get(id) as PolicyProfileRow | undefined;
        return row ? toPolicyProfile(row) : null;
    } catch (err) {
        console.error('[policies] getPolicyProfile failed:', err);
        return null;
    }
}

export function upsertPolicyProfile(profile: Omit<PolicyProfile, 'createdAt' | 'updatedAt'>): void {
    const now = new Date().toISOString();
    getDb().prepare(`
    INSERT INTO policy_profiles (id, name, scope_type, scope_value, rules_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name        = excluded.name,
      scope_type  = excluded.scope_type,
      scope_value = excluded.scope_value,
      rules_json  = excluded.rules_json,
      updated_at  = excluded.updated_at
  `).run(
        profile.id,
        profile.name,
        profile.scopeType,
        profile.scopeValue ?? null,
        JSON.stringify(profile.rules),
        now,
        now,
    );
}

export function deletePolicyProfile(id: string): void {
    getDb().prepare('DELETE FROM policy_profiles WHERE id = ?').run(id);
}

// ─── Audit log ───────────────────────────────────────────────────────────────

export interface PolicyAuditEntry {
    runId?: string;
    toolName: string;
    toolInput: string;
    profileId: string;
    ruleId?: string;
    effect: 'allow' | 'deny' | 'require_approval' | 'pass';
    reason?: string;
}

export function appendPolicyAudit(entry: PolicyAuditEntry): void {
    try {
        getDb().prepare(`
      INSERT INTO policy_audit_log (run_id, tool_name, tool_input, profile_id, rule_id, effect, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
            entry.runId ?? null,
            entry.toolName,
            entry.toolInput.slice(0, 500),
            entry.profileId,
            entry.ruleId ?? null,
            entry.effect,
            entry.reason ?? null,
        );
    } catch {
        // non-fatal — audit is best-effort
    }
}

export function getRecentPolicyAudit(limit = 100): PolicyAuditEntry[] {
    try {
        return getDb()
            .prepare('SELECT * FROM policy_audit_log ORDER BY created_at DESC LIMIT ?')
            .all(limit) as PolicyAuditEntry[];
    } catch {
        return [];
    }
}

// ─── Private helpers ─────────────────────────────────────────────────────────

function toPolicyProfile(row: PolicyProfileRow): PolicyProfile {
    return {
        id: row.id,
        name: row.name,
        scopeType: row.scope_type,
        scopeValue: row.scope_value ?? undefined,
        rules: safeParseRules(row.rules_json),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function safeParseRules(json: string) {
    try {
        return JSON.parse(json || '[]');
    } catch {
        return [];
    }
}
