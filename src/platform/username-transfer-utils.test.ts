import { describe, expect, it } from 'vitest';

import {
  MIN_TRANSFER_PROTOCOL_VERSION,
  deriveCandidateKeys,
  explainKeyIneligibility,
  isEligibleTransferKey,
  isProtocolVersionBlocked,
  isProtocolVersionSupported,
  isValidIdentityId,
  isValidMnemonic,
  normalizeMnemonic,
  selectTransferSigningKey,
} from './username-transfer-utils.js';
import { getPublicKey } from '../crypto/keys.js';
import { hash160 } from '../crypto/hash.js';
import { wifToPrivateKey } from '../utils/wif.js';
import type { IdentityPublicKeyInfo } from '../types.js';

// Standard BIP39 test vector.
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

/** Build an on-chain key record that the given candidate WIF should match. */
function keyRecordForWif(
  privateKeyWif: string,
  overrides: Partial<IdentityPublicKeyInfo> = {}
): IdentityPublicKeyInfo {
  const { privateKey } = wifToPrivateKey(privateKeyWif);
  return {
    id: 0,
    type: 0,
    purpose: 0, // AUTHENTICATION
    securityLevel: 2, // HIGH
    data: getPublicKey(privateKey),
    ...overrides,
  };
}

describe('seed phrase input', () => {
  it('normalizes whitespace and case', () => {
    expect(normalizeMnemonic('  Abandon   ABANDON\nabout  ')).toBe('abandon abandon about');
    expect(normalizeMnemonic('   ')).toBe('');
  });

  it('validates the BIP39 checksum', () => {
    expect(isValidMnemonic(MNEMONIC)).toBe(true);
    expect(isValidMnemonic(MNEMONIC.toUpperCase())).toBe(true);
    // Same words, bad checksum.
    expect(isValidMnemonic(MNEMONIC.replace(/about$/, 'abandon'))).toBe(false);
    expect(isValidMnemonic('not actually bip39 words at all')).toBe(false);
    expect(isValidMnemonic('')).toBe(false);
  });
});

describe('identity ID validation', () => {
  it('accepts 43-44 character Base58 and rejects everything else', () => {
    expect(isValidIdentityId('1'.repeat(44))).toBe(true);
    expect(isValidIdentityId(`  ${'1'.repeat(43)}  `)).toBe(true);
    expect(isValidIdentityId('1'.repeat(42))).toBe(false);
    expect(isValidIdentityId('1'.repeat(45))).toBe(false);
    // 0, O, I and l are not in the Base58 alphabet.
    expect(isValidIdentityId(`0${'1'.repeat(43)}`)).toBe(false);
  });
});

describe('transfer key eligibility', () => {
  it('accepts AUTHENTICATION keys at CRITICAL or HIGH', () => {
    expect(isEligibleTransferKey(0, 1)).toBe(true);
    expect(isEligibleTransferKey(0, 2)).toBe(true);
  });

  it('rejects MASTER, which Platform does not accept for document transitions', () => {
    expect(isEligibleTransferKey(0, 0)).toBe(false);
    expect(explainKeyIneligibility(0, 0)).toContain('MASTER');
  });

  it('rejects MEDIUM and non-AUTHENTICATION purposes', () => {
    expect(isEligibleTransferKey(0, 3)).toBe(false);
    expect(isEligibleTransferKey(3, 1)).toBe(false); // TRANSFER purpose
    expect(explainKeyIneligibility(3, 1)).toContain('TRANSFER');
    expect(explainKeyIneligibility(0, 2)).toBeNull();
  });
});

describe('protocol version gate', () => {
  it('requires protocol version 13, when DPNS transfers were enabled', () => {
    expect(MIN_TRANSFER_PROTOCOL_VERSION).toBe(13);
    expect(isProtocolVersionSupported(12)).toBe(false);
    expect(isProtocolVersionSupported(13)).toBe(true);
    expect(isProtocolVersionSupported(14)).toBe(true);
  });

  it('does not block when the version could not be read', () => {
    // The version read is best-effort; an unknown version must not lock the
    // user out of a transfer the network would actually accept.
    expect(isProtocolVersionBlocked(undefined)).toBe(false);
    expect(isProtocolVersionBlocked(12)).toBe(true);
    expect(isProtocolVersionBlocked(13)).toBe(false);
  });
});

describe('candidate key derivation', () => {
  it('scans identity index 0 first, then sweeps later identity indices', () => {
    const candidates = deriveCandidateKeys(MNEMONIC, 'testnet');

    expect(candidates.slice(0, 5).map((c) => [c.identityIndex, c.keyIndex])).toEqual([
      [0, 0], [0, 1], [0, 2], [0, 3], [0, 4],
    ]);
    expect(candidates.slice(5).map((c) => [c.identityIndex, c.keyIndex])).toEqual([
      [1, 0], [2, 0], [3, 0], [4, 0],
    ]);
  });

  it('uses the DIP-13 identity path with the network coin type', () => {
    expect(deriveCandidateKeys(MNEMONIC, 'testnet')[0].derivationPath).toBe("m/9'/1'/5'/0'/0'/0'/0'");
    expect(deriveCandidateKeys(MNEMONIC, 'mainnet')[0].derivationPath).toBe("m/9'/5'/5'/0'/0'/0'/0'");
    // Devnets derive like testnet.
    expect(deriveCandidateKeys(MNEMONIC, 'devnet-paloma')[0].derivationPath).toBe("m/9'/1'/5'/0'/0'/0'/0'");
  });

  it('derives distinct keys and a matching public key hash', () => {
    const candidates = deriveCandidateKeys(MNEMONIC, 'testnet');
    const wifs = new Set(candidates.map((c) => c.privateKeyWif));
    expect(wifs.size).toBe(candidates.length);

    for (const candidate of candidates) {
      const { privateKey } = wifToPrivateKey(candidate.privateKeyWif);
      expect(getPublicKey(privateKey)).toEqual(candidate.publicKey);
      expect(hash160(candidate.publicKey)).toEqual(candidate.publicKeyHash);
    }
  });

  it('derives the same keys as the mainnet coin type only for mainnet', () => {
    const testnet = deriveCandidateKeys(MNEMONIC, 'testnet')[0];
    const mainnet = deriveCandidateKeys(MNEMONIC, 'mainnet')[0];
    expect(testnet.publicKey).not.toEqual(mainnet.publicKey);
  });
});

describe('signing key selection', () => {
  const candidates = deriveCandidateKeys(MNEMONIC, 'testnet');

  it('returns no_match when the seed controls none of the identity keys', () => {
    const unrelated: IdentityPublicKeyInfo = {
      id: 0, type: 0, purpose: 0, securityLevel: 2, data: new Uint8Array(33),
    };
    expect(selectTransferSigningKey(candidates, [unrelated], 'testnet')).toEqual({ status: 'no_match' });
  });

  it('picks the eligible key even when an ineligible one matches first', () => {
    const keys = [
      keyRecordForWif(candidates[0].privateKeyWif, { id: 0, securityLevel: 0 }), // MASTER
      keyRecordForWif(candidates[2].privateKeyWif, { id: 2, securityLevel: 2 }), // HIGH
    ];

    const selection = selectTransferSigningKey(candidates, keys, 'testnet');
    expect(selection.status).toBe('ok');
    if (selection.status !== 'ok') return;
    expect(selection.keyId).toBe(2);
    expect(selection.candidate.keyIndex).toBe(2);
  });

  it('reports ineligible (not no_match) when only a MASTER key matches', () => {
    const keys = [keyRecordForWif(candidates[0].privateKeyWif, { id: 0, securityLevel: 0 })];
    expect(selectTransferSigningKey(candidates, keys, 'testnet')).toEqual({
      status: 'ineligible',
      keyId: 0,
      purpose: 0,
      securityLevel: 0,
    });
  });

  it('matches ECDSA_HASH160 keys by public key hash', () => {
    const keys = [
      keyRecordForWif(candidates[1].privateKeyWif, {
        id: 7,
        type: 2,
        data: candidates[1].publicKeyHash,
      }),
    ];

    const selection = selectTransferSigningKey(candidates, keys, 'testnet');
    expect(selection.status).toBe('ok');
    if (selection.status !== 'ok') return;
    expect(selection.keyId).toBe(7);
  });

  it('ignores disabled keys', () => {
    const keys = [keyRecordForWif(candidates[0].privateKeyWif, { id: 0, isDisabled: true })];
    expect(selectTransferSigningKey(candidates, keys, 'testnet')).toEqual({ status: 'no_match' });
  });

  it('does not match a testnet-derived key against a mainnet identity', () => {
    const keys = [keyRecordForWif(candidates[0].privateKeyWif, { id: 0 })];
    // findMatchingKeyIndex rejects on WIF network prefix mismatch.
    expect(selectTransferSigningKey(candidates, keys, 'mainnet')).toEqual({ status: 'no_match' });
  });

  // The identity-ID + WIF path feeds a bare {privateKeyWif} through the same
  // selector, so it gets the same eligibility rules as the seed path.
  it('accepts a bare WIF candidate, not just derived keys', () => {
    const wif = candidates[3].privateKeyWif;
    const keys = [keyRecordForWif(wif, { id: 4, securityLevel: 1 })];

    const selection = selectTransferSigningKey([{ privateKeyWif: wif }], keys, 'testnet');
    expect(selection.status).toBe('ok');
    if (selection.status !== 'ok') return;
    expect(selection.keyId).toBe(4);
    expect(selection.candidate.privateKeyWif).toBe(wif);
  });

  it('rejects a bare MASTER WIF as ineligible rather than unmatched', () => {
    const wif = candidates[3].privateKeyWif;
    const keys = [keyRecordForWif(wif, { id: 0, securityLevel: 0 })];

    expect(selectTransferSigningKey([{ privateKeyWif: wif }], keys, 'testnet')).toEqual({
      status: 'ineligible',
      keyId: 0,
      purpose: 0,
      securityLevel: 0,
    });
  });
});
