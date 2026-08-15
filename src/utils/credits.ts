/**
 * Credit/duff/DASH unit conversions for Platform credit withdrawals.
 *
 * 1 duff = 1000 credits; 1 DASH = 100,000,000 duffs = 100,000,000,000 credits.
 */

export const CREDITS_PER_DUFF = 1000n;
export const DUFFS_PER_DASH = 100_000_000n;
export const CREDITS_PER_DASH = CREDITS_PER_DUFF * DUFFS_PER_DASH; // 100_000_000_000n

/**
 * Minimum withdrawal amount enforced by Platform consensus: 1000 duffs.
 * (platform system_limits min_withdrawal_amount, raised from 190 duffs in protocol v12.)
 */
export const MIN_WITHDRAWAL_CREDITS = 1_000_000n;

/**
 * Maximum withdrawal amount enforced by Platform consensus: 500 DASH.
 */
export const MAX_WITHDRAWAL_CREDITS = 50_000_000_000_000n;

/** Max fractional digits a DASH amount can carry at credit precision. */
const DASH_DECIMALS = 11;

/**
 * Parse a decimal DASH amount string into credits.
 * Returns null for anything that isn't a plain non-negative decimal number
 * with at most 11 fractional digits (credit precision).
 */
export function parseDashToCredits(input: string): bigint | null {
  const trimmed = input.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const [wholePart, fracPart = ''] = trimmed.split('.');
  if (fracPart.length > DASH_DECIMALS) return null;
  const fracPadded = fracPart.padEnd(DASH_DECIMALS, '0');
  return BigInt(wholePart) * CREDITS_PER_DASH + BigInt(fracPadded);
}

/**
 * Format a credit amount as a decimal DASH string, trimming trailing zeros.
 */
export function formatCreditsAsDash(credits: bigint): string {
  const negative = credits < 0n;
  const abs = negative ? -credits : credits;
  const whole = abs / CREDITS_PER_DASH;
  const frac = (abs % CREDITS_PER_DASH).toString().padStart(DASH_DECIMALS, '0').replace(/0+$/, '');
  const sign = negative ? '-' : '';
  return frac.length > 0 ? `${sign}${whole}.${frac}` : `${sign}${whole}`;
}

/**
 * Format a credit amount with thousands separators (for "= N credits" captions).
 */
export function formatCredits(credits: bigint): string {
  return credits.toLocaleString('en-US');
}

/**
 * Credits held back from the spendable balance so the withdrawal transition's
 * own Platform processing fee (paid from the remaining identity balance) can
 * still be covered. Heuristic headroom, not a consensus value.
 */
export const WITHDRAWAL_FEE_RESERVE_CREDITS = 50_000_000n; // 0.0005 DASH

/**
 * The most that can be withdrawn from a balance: the per-transition consensus
 * maximum, capped by the balance minus the fee reserve. Can be negative for
 * dust balances — callers compare against MIN_WITHDRAWAL_CREDITS.
 */
export function maxWithdrawableCredits(balanceCredits: bigint): bigint {
  const spendable = balanceCredits - WITHDRAWAL_FEE_RESERVE_CREDITS;
  return spendable > MAX_WITHDRAWAL_CREDITS ? MAX_WITHDRAWAL_CREDITS : spendable;
}

export type WithdrawalAmountValidation = { credits: bigint } | { error: string };

/**
 * Parse and validate a user-entered DASH amount against the consensus limits
 * and the identity's balance (including fee-reserve headroom).
 */
export function validateWithdrawalAmount(
  input: string,
  balanceCredits: bigint
): WithdrawalAmountValidation {
  const credits = parseDashToCredits(input);
  if (credits === null) {
    return { error: 'Enter a valid DASH amount (up to 11 decimal places)' };
  }
  if (credits < MIN_WITHDRAWAL_CREDITS) {
    return { error: `Minimum withdrawal is ${formatCreditsAsDash(MIN_WITHDRAWAL_CREDITS)} DASH (1000 duffs)` };
  }
  if (credits > MAX_WITHDRAWAL_CREDITS) {
    return { error: `Maximum withdrawal is ${formatCreditsAsDash(MAX_WITHDRAWAL_CREDITS)} DASH per transaction` };
  }
  if (credits > balanceCredits) {
    return { error: `Amount exceeds your balance of ${formatCreditsAsDash(balanceCredits)} DASH` };
  }
  if (credits > maxWithdrawableCredits(balanceCredits)) {
    return {
      error: `Amount is too close to your full balance to cover the Platform transition fee. Maximum: ${formatCreditsAsDash(maxWithdrawableCredits(balanceCredits))} DASH`,
    };
  }
  return { credits };
}
