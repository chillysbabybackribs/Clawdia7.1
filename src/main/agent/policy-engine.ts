import type { PolicyProfile, PolicyRule } from '../../shared/types';
import {
    getPolicyProfile,
    listPolicyProfiles,
    appendPolicyAudit,
} from '../db/policies';
import { loadSettings } from '../settingsStore';

// ─── Public types ─────────────────────────────────────────────────────────────

export type PolicyEffect = 'allow' | 'deny' | 'require_approval';

export interface PolicyDecision {
    /** What the engine decided. 'allow' = proceed, 'deny' = hard block, 'require_approval' = gate on user. */
    effect: PolicyEffect;
    /** Human-readable justification shown in the UI. */
    reason: string;
    /** The rule that triggered this decision (null when no rule matched → default allow). */
    ruleId: string | null;
    /** Profile that was active when the decision was made. */
    profileId: string;
    profileName: string;
}

export interface PolicyContext {
    /** Optional run id for audit log linkage. */
    runId?: string;
    /** If present, allows profile to be resolved by workspace path (future). */
    workspacePath?: string;
}

// ─── Sentinel for "unrestricted" mode ────────────────────────────────────────

const ALLOW_ALL: PolicyDecision = {
    effect: 'allow',
    reason: 'Unrestricted mode — policy evaluation skipped.',
    ruleId: null,
    profileId: 'none',
    profileName: 'Unrestricted',
};

// ─── Evaluator ────────────────────────────────────────────────────────────────

/**
 * Evaluate a tool call against the currently active policy profile.
 *
 * The decision is always logged to `policy_audit_log` (best-effort).
 *
 * Decision priority when multiple rules match:
 *   deny  >  require_approval  >  allow
 *
 * This is an improvement over 4.0's "first-match wins" which silently ignored
 * subsequent deny rules that were listed after an allow rule.
 */
export function evaluatePolicy(
    toolName: string,
    input: Record<string, unknown>,
    ctx: PolicyContext = {},
): PolicyDecision {
    const settings = loadSettings();

    if (settings.unrestrictedMode) {
        // Still audit, but short-circuit
        appendPolicyAudit({
            runId: ctx.runId,
            toolName,
            toolInput: JSON.stringify(input),
            profileId: 'unrestricted',
            effect: 'allow',
            reason: 'Unrestricted mode enabled.',
        });
        return ALLOW_ALL;
    }

    const profile = resolveActiveProfile(settings.policyProfile);
    if (!profile) {
        // No profile found → fail open with a logged warning
        console.warn(`[policy] No profile found for id="${settings.policyProfile}", failing open.`);
        return {
            effect: 'allow',
            reason: 'No active policy profile found (failing open).',
            ruleId: null,
            profileId: settings.policyProfile,
            profileName: 'Unknown',
        };
    }

    // Collect all matching rules
    const matchingRules = profile.rules.filter(
        (r) => r.enabled && matchesRule(r, toolName, input),
    );

    // Priority: deny > require_approval > allow (no explicit "allow" effect in our schema)
    const deny = matchingRules.find((r) => r.effect === 'deny');
    const requireApproval = matchingRules.find((r) => r.effect === 'require_approval');
    const winner = deny ?? requireApproval ?? null;

    const decision: PolicyDecision = winner
        ? {
            effect: winner.effect as PolicyEffect,
            reason: winner.reason,
            ruleId: winner.id,
            profileId: profile.id,
            profileName: profile.name,
        }
        : {
            effect: 'allow',
            reason: 'No matching rule — default allow.',
            ruleId: null,
            profileId: profile.id,
            profileName: profile.name,
        };

    // Audit every decision asynchronously (non-blocking)
    appendPolicyAudit({
        runId: ctx.runId,
        toolName,
        toolInput: JSON.stringify(input),
        profileId: profile.id,
        ruleId: decision.ruleId ?? undefined,
        effect: decision.effect,
        reason: decision.reason,
    });

    return decision;
}

/**
 * Convenience — returns true if the tool call is allowed immediately.
 * Callers that only need a boolean can use this.
 */
export function isPolicyAllowed(
    toolName: string,
    input: Record<string, unknown>,
    ctx?: PolicyContext,
): boolean {
    return evaluatePolicy(toolName, input, ctx).effect === 'allow';
}

// ─── Profile resolution ───────────────────────────────────────────────────────

function resolveActiveProfile(profileId: string): PolicyProfile | null {
    return getPolicyProfile(profileId) ?? getPolicyProfile('standard');
}

/** Exported for the settings panel — lists all available profiles. */
export { listPolicyProfiles };

// ─── Rule matching ────────────────────────────────────────────────────────────

function matchesRule(
    rule: PolicyRule,
    toolName: string,
    input: Record<string, unknown>,
): boolean {
    const { match } = rule;

    // ── Tool name filter ─────────────────────────────────────────────────────
    if (match.toolNames?.length && !match.toolNames.includes(toolName)) {
        return false;
    }

    // ── Command pattern filter ───────────────────────────────────────────────
    if (match.commandPatterns?.length) {
        const command = extractCommand(input);
        if (!command) return false;
        const matched = match.commandPatterns.some((pattern) => {
            try {
                return new RegExp(pattern, 'i').test(command);
            } catch {
                return false;
            }
        });
        if (!matched) return false;
    }

    // ── Path prefix filter ───────────────────────────────────────────────────
    if (match.pathPrefixes?.length) {
        const targetPath = extractPath(input);
        if (!targetPath) return false;
        const normalized = normalizePath(targetPath);
        const matched = match.pathPrefixes.some((prefix) =>
            normalized.includes(normalizePath(prefix)),
        );
        if (!matched) return false;
    }

    return true;
}

/** Pull the "command-like" string from any tool input shape. */
function extractCommand(input: Record<string, unknown>): string {
    return String(
        input.command ?? input.cmd ?? input.text ?? input.selector ?? '',
    ).trim();
}

/** Pull the "path-like" string from any tool input shape. */
function extractPath(input: Record<string, unknown>): string {
    return String(input.path ?? input.file ?? input.target ?? '').trim();
}

function normalizePath(value: string): string {
    return value.replace(/\\/g, '/').toLowerCase();
}
