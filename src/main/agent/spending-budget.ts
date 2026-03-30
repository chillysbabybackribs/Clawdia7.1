import { listActiveBudgets, sumPeriodSpend, insertTransaction, updateTransactionToActual, updateTransactionStatus, type BudgetPeriod } from '../db/spending';

export interface BudgetCheckResult {
    allowed: boolean;
    remaining: number;      // cents remaining in most restrictive active budget
    blockedBy: BudgetPeriod | null;
    periodSpent: number;
    periodLimit: number;
}

function periodStartIso(period: BudgetPeriod, resetDay?: number): string {
    const now = new Date();
    if (period === 'daily') {
        const start = new Date(now);
        start.setHours(0, 0, 0, 0);
        return start.toISOString();
    }
    if (period === 'weekly') {
        const day = resetDay ?? 1; // default Monday
        const start = new Date(now);
        const diff = (start.getDay() - day + 7) % 7;
        start.setDate(start.getDate() - diff);
        start.setHours(0, 0, 0, 0);
        return start.toISOString();
    }
    // monthly
    const now2 = new Date(now);
    const targetMonth = (resetDay ?? 1) > now2.getDate() ? now2.getMonth() - 1 : now2.getMonth();
    const targetYear = targetMonth < 0 ? now2.getFullYear() - 1 : now2.getFullYear();
    const normalizedMonth = ((targetMonth % 12) + 12) % 12;
    const daysInMonth = new Date(targetYear, normalizedMonth + 1, 0).getDate();
    const clampedDay = Math.min(resetDay ?? 1, daysInMonth);
    const start = new Date(targetYear, normalizedMonth, clampedDay, 0, 0, 0, 0);
    return start.toISOString();
}

/** Check if world is within budget for an expected spending (in cents). */
export function checkBudget(amountUsdCents: number): BudgetCheckResult {
    const budgets = listActiveBudgets();
    if (budgets.length === 0) {
        return { allowed: true, remaining: Infinity, blockedBy: null, periodSpent: 0, periodLimit: 0 };
    }

    let mostRestrictive: BudgetCheckResult = {
        allowed: true,
        remaining: Infinity,
        blockedBy: null,
        periodSpent: 0,
        periodLimit: 0,
    };

    for (const budget of budgets) {
        const since = periodStartIso(budget.period, budget.resetDay);
        const spent = sumPeriodSpend(since);
        const remaining = budget.limitUsd - spent;
        const wouldExceed = spent + amountUsdCents > budget.limitUsd;

        if (wouldExceed) {
            if (mostRestrictive.allowed || remaining < mostRestrictive.remaining) {
                mostRestrictive = {
                    allowed: false,
                    remaining,
                    blockedBy: budget.period,
                    periodSpent: spent,
                    periodLimit: budget.limitUsd,
                };
            }
        } else if (mostRestrictive.allowed && remaining < mostRestrictive.remaining) {
            mostRestrictive = {
                allowed: true,
                remaining,
                blockedBy: null,
                periodSpent: spent,
                periodLimit: budget.limitUsd,
            };
        }
    }

    return mostRestrictive;
}

/** Reserve an estimated spend for a run. Returns transactionId. */
export function reserveEstimate(runId: string, merchant: string, estimatedCents: number): number {
    return insertTransaction({
        runId,
        merchant,
        amountUsd: estimatedCents,
        isEstimated: true,
        status: 'pending',
    });
}

/** Finalize a transaction with actual spend. */
export function confirmTransaction(transactionId: number, actualCents: number): void {
    updateTransactionToActual(transactionId, actualCents);
}

/** Roll back a transaction (e.g. failed request). */
export function cancelReservation(transactionId: number): void {
    updateTransactionStatus(transactionId, 'failed');
}

/** Helper for UI to show status. */
export function getRemainingBudgets(): Array<{ period: string; remaining: number; limit: number; spent: number }> {
    const budgets = listActiveBudgets();
    return budgets.map(budget => {
        const since = periodStartIso(budget.period, budget.resetDay);
        const spent = sumPeriodSpend(since);
        return {
            period: budget.period,
            remaining: budget.limitUsd - spent,
            limit: budget.limitUsd,
            spent,
        };
    });
}
