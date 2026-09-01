import { validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { mnemonicToHDKey, deriveKeyAtPath, getIdentityKeyDerivationPath } from '../crypto/hd.js';
import {
  findMatchingKeyIndex,
  getPublicKey,
  getSecurityLevelName,
  getPurposeName,
  isPurposeAllowedForDpns,
  isSecurityLevelAllowedForDpns,
} from '../crypto/keys.js';
import { hash160 } from '../crypto/hash.js';
import { privateKeyToWif } from '../utils/wif.js';
import { getNetwork } from '../config.js';
import type { IdentityPublicKeyInfo } from '../types.js';

/**
 * DPNS `domain` documents only became transferable at protocol version 13.
 * Before that a data trigger rejected Transfer outright, so there is no point
 * letting the user sign a transition an older network will refuse.
 */
export const MIN_TRANSFER_PROTOCOL_VERSION = 13;

/** How many key indices to scan under the first identity index. */
const KEY_INDEX_SCAN_DEPTH = 5;

/** How many additional identity indices to probe (first key only). */
const IDENTITY_INDEX_GAP_LIMIT = 5;

/**
 * A key derived from the user's seed phrase, and everything needed to match it
 * against an identity's on-chain keys.
 */
export interface DerivedCandidateKey {
  identityIndex: number;
  keyIndex: number;
  derivationPath: string;
  publicKey: Uint8Array;
  /** hash160 of the compressed public key — the identity lookup key */
  publicKeyHash: Uint8Array;
  privateKeyWif: string;
}

/** Result of matching derived candidates against an identity's keys. */
export type SigningKeySelection =
  | {
      status: 'ok';
      candidate: DerivedCandidateKey;
      keyId: number;
      purpose: number;
      securityLevel: number;
    }
  | { status: 'ineligible'; keyId: number; purpose: number; securityLevel: number }
  | { status: 'no_match' };

/**
 * Normalize user-entered seed phrase input: collapse whitespace/newlines and
 * lowercase. BIP39 English words are lowercase, and pasted phrases routinely
 * arrive with line breaks or double spaces.
 */
export function normalizeMnemonic(input: string): string {
  return input.trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ');
}

/**
 * Validate a BIP39 seed phrase (checksum included).
 */
export function isValidMnemonic(input: string): boolean {
  const normalized = normalizeMnemonic(input);
  if (!normalized) return false;
  try {
    return validateMnemonic(normalized, wordlist);
  } catch {
    return false;
  }
}

/**
 * Validate a Base58 identity ID, matching the format check used elsewhere in
 * the app for identity input.
 */
export function isValidIdentityId(identityId: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(identityId.trim());
}

/**
 * Whether a key may sign a DPNS domain transfer.
 *
 * Platform requires AUTHENTICATION purpose (a document transfer is not a token
 * transfer, so `purpose_requirement()` is `[AUTHENTICATION]`), and the DPNS
 * `domain` type declares no explicit signature security level, so it defaults
 * to HIGH — which the protocol expands to {CRITICAL, HIGH}. MASTER is *not*
 * accepted. These are the same constraints as DPNS registration.
 */
export function isEligibleTransferKey(purpose: number, securityLevel: number): boolean {
  return isPurposeAllowedForDpns(purpose) && isSecurityLevelAllowedForDpns(securityLevel);
}

/**
 * Explain why a matched key cannot sign a transfer, or null if it can.
 */
export function explainKeyIneligibility(purpose: number, securityLevel: number): string | null {
  if (!isPurposeAllowedForDpns(purpose)) {
    return `This key has ${getPurposeName(purpose)} purpose. Username transfers must be signed with an AUTHENTICATION key.`;
  }
  if (!isSecurityLevelAllowedForDpns(securityLevel)) {
    return `This key has ${getSecurityLevelName(securityLevel)} security level. Username transfers must be signed with a CRITICAL or HIGH level key.`;
  }
  return null;
}

/**
 * Whether the network's protocol version supports DPNS username transfers.
 */
export function isProtocolVersionSupported(protocolVersion: number): boolean {
  return protocolVersion >= MIN_TRANSFER_PROTOCOL_VERSION;
}

/**
 * Derive the identity key candidates to probe for a seed phrase.
 *
 * Ordered cheapest-first: every key index under identity index 0 (which covers
 * every identity this app creates), then the first key of each subsequent
 * identity index as a gap-limit sweep. Callers walk this list in order and stop
 * at the first hit, so ordering is what keeps discovery to a couple of round
 * trips in the common case.
 */
export function deriveCandidateKeys(mnemonic: string, network: string): DerivedCandidateKey[] {
  const normalized = normalizeMnemonic(mnemonic);
  const hdKey = mnemonicToHDKey(normalized);
  const networkConfig = getNetwork(network);

  const slots: { identityIndex: number; keyIndex: number }[] = [];
  for (let keyIndex = 0; keyIndex < KEY_INDEX_SCAN_DEPTH; keyIndex++) {
    slots.push({ identityIndex: 0, keyIndex });
  }
  for (let identityIndex = 1; identityIndex < IDENTITY_INDEX_GAP_LIMIT; identityIndex++) {
    slots.push({ identityIndex, keyIndex: 0 });
  }

  return slots.map(({ identityIndex, keyIndex }) => {
    const derivationPath = getIdentityKeyDerivationPath(keyIndex, network, identityIndex);
    const { privateKey } = deriveKeyAtPath(hdKey, derivationPath);
    const publicKey = getPublicKey(privateKey);

    return {
      identityIndex,
      keyIndex,
      derivationPath,
      publicKey,
      publicKeyHash: hash160(publicKey),
      privateKeyWif: privateKeyToWif(privateKey, networkConfig),
    };
  });
}

/**
 * Pick the derived key that can sign a transfer for this identity.
 *
 * Returns `ineligible` (rather than `no_match`) when the seed does control a
 * registered key but none of them may sign a transfer — most often a seed that
 * only yields a MASTER key. That distinction drives a much more useful error
 * message, since the fix is to add a HIGH AUTHENTICATION key rather than to
 * find a different seed.
 */
export function selectTransferSigningKey(
  candidates: DerivedCandidateKey[],
  identityKeys: IdentityPublicKeyInfo[],
  network: string
): SigningKeySelection {
  const enabledKeys = identityKeys.filter((key) => !key.isDisabled);
  let ineligible: SigningKeySelection | undefined;

  for (const candidate of candidates) {
    const match = findMatchingKeyIndex(candidate.privateKeyWif, enabledKeys, network);
    if (!match) continue;

    if (isEligibleTransferKey(match.purpose, match.securityLevel)) {
      return {
        status: 'ok',
        candidate,
        keyId: match.keyId,
        purpose: match.purpose,
        securityLevel: match.securityLevel,
      };
    }

    ineligible ??= {
      status: 'ineligible',
      keyId: match.keyId,
      purpose: match.purpose,
      securityLevel: match.securityLevel,
    };
  }

  return ineligible ?? { status: 'no_match' };
}
