import { describe, expect, it } from 'vitest';

import {
  convertToHomographSafe,
  countUsernameStatuses,
  createEmptyUsernameEntry,
  createUsernameEntry,
  isContestedUsername,
  shouldShowContestedWarning,
  validateDpnsLabel,
} from './dpns-utils.js';
import type { DpnsUsernameEntry } from '../types.js';

describe('DPNS username helpers', () => {
  it('validates username label shape', () => {
    expect(validateDpnsLabel('dash-user')).toEqual({ isValid: true });
    expect(validateDpnsLabel('')).toEqual({ isValid: false, error: 'Username is required' });
    expect(validateDpnsLabel('ab')).toEqual({ isValid: false, error: 'Minimum 3 characters' });
    expect(validateDpnsLabel('-dash')).toEqual({ isValid: false, error: 'Must start with letter or number' });
    expect(validateDpnsLabel('dash-')).toEqual({ isValid: false, error: 'Must end with letter or number' });
    expect(validateDpnsLabel('dash_user')).toEqual({ isValid: false, error: 'Only letters, numbers, and hyphens allowed' });
    expect(validateDpnsLabel('dash--user')).toEqual({ isValid: false, error: 'No consecutive hyphens allowed' });
  });

  it('folds l, i and o, so a display label is not its normalizedLabel', () => {
    // This is why a username cannot be resolved back to its document from the
    // name shown in the UI: the index is on normalizedLabel, but the display
    // form uses the raw label. Any name containing l, i or o diverges.
    expect(convertToHomographSafe('testfjdksla234123')).toBe('testfjdks1a234123');
    expect(convertToHomographSafe('pastafaucettesting1234')).toBe('pastafaucettest1ng1234');
    // A name with none of those characters round-trips, which is how a live
    // transfer of "xfertest7pasta" passed while the bug was present.
    expect(convertToHomographSafe('xfertest7pasta')).toBe('xfertest7pasta');
  });

  it('normalizes labels for homograph-safe contested-name checks', () => {
    expect(convertToHomographSafe('Oil-Loom')).toBe('011-100m');
    expect(isContestedUsername('dash')).toBe(true);
    expect(isContestedUsername('dash2')).toBe(false);
    expect(isContestedUsername('a'.repeat(20))).toBe(false);
  });

  it('creates entries with normalized contested metadata', () => {
    expect(createEmptyUsernameEntry()).toEqual({
      label: '',
      normalizedLabel: '',
      isValid: false,
      status: 'pending',
    });

    expect(createUsernameEntry('Oil')).toMatchObject({
      label: 'Oil',
      normalizedLabel: '011',
      isValid: true,
      isContested: true,
      status: 'pending',
    });

    expect(createUsernameEntry('dash2')).toMatchObject({
      normalizedLabel: 'dash2',
      isValid: true,
      isContested: false,
    });
  });

  it('summarizes username availability and contested-warning state', () => {
    const usernames: DpnsUsernameEntry[] = [
      { ...createUsernameEntry('dash'), isAvailable: true },
      { ...createUsernameEntry('name2'), isAvailable: true },
      { ...createUsernameEntry('taken'), isAvailable: false },
      createUsernameEntry('no'),
    ];

    expect(shouldShowContestedWarning(usernames)).toBe(false);
    expect(countUsernameStatuses(usernames)).toEqual({
      available: 2,
      taken: 1,
      invalid: 1,
      contested: 1,
      nonContested: 1,
    });

    expect(shouldShowContestedWarning([
      { ...createUsernameEntry('dash'), isAvailable: true },
      { ...createUsernameEntry('oil'), isAvailable: true },
    ])).toBe(true);
  });
});
