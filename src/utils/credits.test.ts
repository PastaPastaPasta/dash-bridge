import { describe, it, expect } from 'vitest';

import {
  CREDITS_PER_DASH,
  MIN_WITHDRAWAL_CREDITS,
  MAX_WITHDRAWAL_CREDITS,
  WITHDRAWAL_FEE_RESERVE_CREDITS,
  parseDashToCredits,
  formatCreditsAsDash,
  formatCredits,
  maxWithdrawableCredits,
  validateWithdrawalAmount,
} from './credits.js';

describe('parseDashToCredits', () => {
  it('parses whole DASH amounts', () => {
    expect(parseDashToCredits('1')).toBe(CREDITS_PER_DASH);
    expect(parseDashToCredits('500')).toBe(MAX_WITHDRAWAL_CREDITS);
  });

  it('parses fractional amounts at credit precision', () => {
    expect(parseDashToCredits('0.00001')).toBe(1_000_000n); // 1000 duffs
    expect(parseDashToCredits('0.00000001')).toBe(1000n); // 1 duff
    expect(parseDashToCredits('0.00000000001')).toBe(1n); // 1 credit
    expect(parseDashToCredits('1.5')).toBe(150_000_000_000n);
  });

  it('accepts the consensus minimum as a DASH string', () => {
    expect(parseDashToCredits('0.00001')).toBe(MIN_WITHDRAWAL_CREDITS);
  });

  it('rejects more than 11 fractional digits', () => {
    expect(parseDashToCredits('0.000000000001')).toBeNull();
  });

  it('rejects malformed input', () => {
    expect(parseDashToCredits('')).toBeNull();
    expect(parseDashToCredits('abc')).toBeNull();
    expect(parseDashToCredits('-1')).toBeNull();
    expect(parseDashToCredits('1.')).toBeNull();
    expect(parseDashToCredits('.5')).toBeNull();
    expect(parseDashToCredits('1e5')).toBeNull();
    expect(parseDashToCredits('1,5')).toBeNull();
  });

  it('trims surrounding whitespace', () => {
    expect(parseDashToCredits(' 2 ')).toBe(2n * CREDITS_PER_DASH);
  });
});

describe('formatCreditsAsDash', () => {
  it('formats whole DASH without a fraction', () => {
    expect(formatCreditsAsDash(CREDITS_PER_DASH)).toBe('1');
    expect(formatCreditsAsDash(0n)).toBe('0');
  });

  it('trims trailing zeros in the fraction', () => {
    expect(formatCreditsAsDash(150_000_000_000n)).toBe('1.5');
    expect(formatCreditsAsDash(1_000_000n)).toBe('0.00001');
    expect(formatCreditsAsDash(1n)).toBe('0.00000000001');
  });

  it('formats mid-range balances', () => {
    expect(formatCreditsAsDash(250_000_000_000n)).toBe('2.5');
  });

  it('round-trips with parseDashToCredits', () => {
    for (const credits of [1n, 1000n, MIN_WITHDRAWAL_CREDITS, 123_456_789_012n, MAX_WITHDRAWAL_CREDITS]) {
      expect(parseDashToCredits(formatCreditsAsDash(credits))).toBe(credits);
    }
  });
});

describe('formatCredits', () => {
  it('adds thousands separators', () => {
    expect(formatCredits(1_000_000n)).toBe('1,000,000');
    expect(formatCredits(1234n)).toBe('1,234');
  });
});

describe('maxWithdrawableCredits', () => {
  it('reserves fee headroom from the balance', () => {
    expect(maxWithdrawableCredits(1_000_000_000n)).toBe(1_000_000_000n - WITHDRAWAL_FEE_RESERVE_CREDITS);
  });

  it('caps at the consensus maximum for huge balances', () => {
    expect(maxWithdrawableCredits(MAX_WITHDRAWAL_CREDITS * 3n)).toBe(MAX_WITHDRAWAL_CREDITS);
  });

  it('goes negative for dust balances', () => {
    expect(maxWithdrawableCredits(1000n) < 0n).toBe(true);
  });
});

describe('validateWithdrawalAmount', () => {
  const balance = 25_000_000_000n; // 0.25 DASH

  it('accepts a normal amount', () => {
    expect(validateWithdrawalAmount('0.1', balance)).toEqual({ credits: 10_000_000_000n });
  });

  it('rejects malformed input', () => {
    const result = validateWithdrawalAmount('abc', balance);
    expect('error' in result && result.error).toContain('valid DASH amount');
  });

  it('rejects amounts below the consensus minimum', () => {
    const result = validateWithdrawalAmount('0.000001', balance);
    expect('error' in result && result.error).toContain('Minimum withdrawal');
  });

  it('rejects amounts above the consensus maximum', () => {
    const result = validateWithdrawalAmount('501', MAX_WITHDRAWAL_CREDITS * 2n);
    expect('error' in result && result.error).toContain('Maximum withdrawal');
  });

  it('rejects amounts above the balance', () => {
    const result = validateWithdrawalAmount('1', balance);
    expect('error' in result && result.error).toContain('exceeds your balance');
  });

  it('rejects amounts inside the fee-reserve headroom', () => {
    // Between balance - reserve and balance: passes the plain balance check
    // but not the fee-reserve check.
    const result = validateWithdrawalAmount('0.24999', balance);
    expect('error' in result && result.error).toContain('transition fee');
  });

  it('accepts exactly the max withdrawable amount', () => {
    const max = maxWithdrawableCredits(balance);
    expect(validateWithdrawalAmount(formatCreditsAsDash(max), balance)).toEqual({ credits: max });
  });
});
