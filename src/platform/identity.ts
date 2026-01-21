import { EvoSDK } from '@dashevo/evo-sdk';
import { sha256 } from '@noble/hashes/sha256';
import { ripemd160 } from '@noble/hashes/ripemd160';
import * as secp256k1 from '@noble/secp256k1';
import type { PublicKeyInfo, IdentityKeyConfig } from '../types.js';
import { withRetry, type RetryOptions } from '../utils/retry.js';

/**
 * Compute hash160 (RIPEMD160(SHA256(data))) of a buffer
 */
function hash160(data: Uint8Array): Uint8Array {
  return ripemd160(sha256(data));
}

/**
 * Identity key types as defined by Dash Platform
 */
export const KeyType = {
  ECDSA_SECP256K1: 0,
  BLS12_381: 1,
  ECDSA_HASH160: 2,
  BIP13_SCRIPT_HASH: 3,
  EDDSA_25519_HASH160: 4,
} as const;

/**
 * Key purposes as defined by Dash Platform
 */
export const KeyPurpose = {
  AUTHENTICATION: 0,
  ENCRYPTION: 1,
  DECRYPTION: 2,
  TRANSFER: 3,
  OWNER: 4,
  VOTING: 5,
} as const;

/**
 * Security levels as defined by Dash Platform
 */
export const SecurityLevel = {
  MASTER: 0,
  CRITICAL: 1,
  HIGH: 2,
  MEDIUM: 3,
} as const;

/**
 * Key type strings as expected by SDK
 */
export const KeyTypeString = {
  ECDSA_SECP256K1: 'ECDSA_SECP256K1',
  BLS12_381: 'BLS12_381',
  ECDSA_HASH160: 'ECDSA_HASH160',
} as const;

/**
 * Key purpose strings as expected by SDK
 */
export const KeyPurposeString = {
  AUTHENTICATION: 'AUTHENTICATION',
  ENCRYPTION: 'ENCRYPTION',
  DECRYPTION: 'DECRYPTION',
  TRANSFER: 'TRANSFER',
  OWNER: 'OWNER',
  VOTING: 'VOTING',
} as const;

/**
 * Security level strings as expected by SDK
 */
export const SecurityLevelString = {
  MASTER: 'MASTER',
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
} as const;

/**
 * Create a public key info object for identity registration
 */
export function createPublicKeyInfo(
  id: number,
  publicKeyBase64: string,
  options: {
    type?: number;
    purpose?: number;
    securityLevel?: number;
    readOnly?: boolean;
  } = {}
): PublicKeyInfo {
  return {
    id,
    type: options.type ?? KeyType.ECDSA_SECP256K1,
    purpose: options.purpose ?? KeyPurpose.AUTHENTICATION,
    securityLevel: options.securityLevel ?? SecurityLevel.MASTER,
    data: publicKeyBase64,
    readOnly: options.readOnly ?? false,
  };
}

/**
 * Convert a public key bytes to base64 for SDK
 */
export function publicKeyToBase64(publicKey: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < publicKey.length; i++) {
    binary += String.fromCharCode(publicKey[i]);
  }
  return btoa(binary);
}

/**
 * Register an identity on Dash Platform
 */
export async function registerIdentity(
  assetLockProof: string,
  assetLockPrivateKeyWif: string,
  identityKeys: IdentityKeyConfig[],
  network: 'testnet' | 'mainnet',
  retryOptions?: RetryOptions
): Promise<{ identityId: string; balance: number; revision: number }> {
  // Initialize SDK for the target network
  const sdk = network === 'mainnet'
    ? EvoSDK.mainnet()
    : EvoSDK.testnet();

  // Connect to the network with retry
  console.log(`Connecting to ${network}...`);
  await withRetry(() => sdk.connect(), retryOptions);
  console.log('Connected to Platform');

  // Create the identity using the SDK format
  // The SDK expects publicKeys as a JSON string with keyType, purpose, securityLevel as strings
  const publicKeysForSdk = identityKeys.map((key) => ({
    keyType: key.keyType,
    purpose: key.purpose,
    securityLevel: key.securityLevel,
    privateKeyHex: key.privateKeyHex,
  }));

  console.log('Creating identity with', publicKeysForSdk.length, 'keys...');
  // Note: The SDK types say unknown[] but the actual implementation expects a JSON string
  const identity = await withRetry(
    () => sdk.identities.create({
      assetLockProof,
      assetLockPrivateKeyWif,
      publicKeys: JSON.stringify(publicKeysForSdk) as unknown as unknown[],
    }),
    retryOptions
  );

  console.log('Identity created:', identity);

  return {
    identityId: identity.identityId || identity.id?.() || String(identity),
    balance: identity.balance || 0,
    revision: identity.revision || 0,
  };
}

/**
 * Top up an existing identity on Dash Platform
 *
 * This is simpler than identity creation:
 * - No identity keys needed
 * - Just needs identityId, proof, and asset lock private key
 *
 * Note: Uses trusted mode because topUp needs to fetch the identity first,
 * which requires quorum verification that's only available in trusted mode.
 */
export async function topUpIdentity(
  identityId: string,
  assetLockProof: string,
  assetLockPrivateKeyWif: string,
  network: 'testnet' | 'mainnet',
  retryOptions?: RetryOptions
): Promise<{ success: boolean; balance?: number }> {
  // Initialize SDK for the target network (trusted mode required for identity fetch)
  const sdk = network === 'mainnet'
    ? EvoSDK.mainnetTrusted()
    : EvoSDK.testnetTrusted();

  // Connect to the network with retry
  console.log(`Connecting to ${network}...`);
  await withRetry(() => sdk.connect(), retryOptions);
  console.log('Connected to Platform');

  console.log('Topping up identity:', identityId);
  const result = await withRetry(
    () => sdk.identities.topUp({
      identityId,
      assetLockProof,
      assetLockPrivateKeyWif,
    }),
    retryOptions
  );

  console.log('Top-up result:', result);

  return {
    success: true,
    balance: result.balance || undefined,
  };
}

/**
 * Configuration for a key to add during identity update
 */
export interface AddKeyConfig {
  keyType: string;  // 'ECDSA_SECP256K1' | 'ECDSA_HASH160'
  purpose: string;  // 'AUTHENTICATION' | 'TRANSFER' | etc.
  securityLevel: string;  // 'CRITICAL' | 'HIGH' | 'MEDIUM'
  /** For generated keys: hex-encoded private key (SDK derives public key) */
  privateKeyHex?: string;
  /** For generated keys: hex-encoded public key */
  publicKeyHex?: string;
  /** For imported keys: base64-encoded public key data */
  publicKeyBase64?: string;
}

/**
 * Update an identity on Dash Platform (add/disable keys)
 *
 * Requirements:
 * - privateKeyWif must be for a MASTER or CRITICAL level key
 * - Cannot disable the key used for signing
 *
 * Note: Uses trusted mode because update needs to fetch the identity first,
 * which requires quorum verification that's only available in trusted mode.
 */
export async function updateIdentity(
  identityId: string,
  privateKeyWif: string,
  addPublicKeys: AddKeyConfig[],
  disablePublicKeyIds: number[],
  network: 'testnet' | 'mainnet',
  retryOptions?: RetryOptions
): Promise<{ success: boolean; error?: string }> {
  // Initialize SDK for the target network (trusted mode required for identity fetch)
  const sdk = network === 'mainnet'
    ? EvoSDK.mainnetTrusted()
    : EvoSDK.testnetTrusted();

  console.log(`Connecting to ${network}...`);
  await withRetry(() => sdk.connect(), retryOptions);
  console.log('Connected to Platform');

  try {
    console.log('Updating identity:', identityId);
    console.log('Adding', addPublicKeys.length, 'keys, disabling', disablePublicKeyIds.length, 'keys');

    // Format keys for SDK
    // identity_update requires pre-computed 'data' field (unlike identity_create which accepts privateKeyHex)
    // For ECDSA_SECP256K1 keys: derive compressed public key and pass as base64 'data'
    // For ECDSA_HASH160 keys: compute hash160 of public key and pass as base64 'data'
    const formattedAddKeys = addPublicKeys.map(key => {
      const isHash160Type = key.keyType === 'ECDSA_HASH160';
      const isSecp256k1Type = key.keyType === 'ECDSA_SECP256K1';

      if (isSecp256k1Type && key.privateKeyHex) {
        // For SECP256K1 type, derive compressed public key from private key
        const privKeyBytes = new Uint8Array(key.privateKeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
        const pubKeyBytes = secp256k1.getPublicKey(privKeyBytes, true); // compressed = true
        const dataBase64 = btoa(String.fromCharCode(...pubKeyBytes));

        return {
          keyType: key.keyType,
          purpose: key.purpose,
          securityLevel: key.securityLevel,
          data: dataBase64,
        };
      } else if (isHash160Type && (key.privateKeyHex || key.publicKeyHex)) {
        // For HASH160 type, compute hash160 of the public key
        let pubKeyBytes: Uint8Array;
        if (key.publicKeyHex) {
          pubKeyBytes = new Uint8Array(key.publicKeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
        } else {
          // Derive public key from private key
          const privKeyBytes = new Uint8Array(key.privateKeyHex!.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
          pubKeyBytes = secp256k1.getPublicKey(privKeyBytes, true);
        }
        const hash160Bytes = hash160(pubKeyBytes);
        const dataBase64 = btoa(String.fromCharCode(...hash160Bytes));

        return {
          keyType: key.keyType,
          purpose: key.purpose,
          securityLevel: key.securityLevel,
          data: dataBase64,
        };
      } else if (key.publicKeyBase64) {
        // Pre-computed base64 data provided directly
        return {
          keyType: key.keyType,
          purpose: key.purpose,
          securityLevel: key.securityLevel,
          data: key.publicKeyBase64,
        };
      } else {
        throw new Error(`Key requires privateKeyHex, publicKeyHex, or publicKeyBase64 for identity update`);
      }
    });

    console.log('Formatted keys to add:', JSON.stringify(formattedAddKeys, null, 2));

    const result = await withRetry(
      () => sdk.identities.update({
        identityId,
        privateKeyWif,
        addPublicKeys: formattedAddKeys.length > 0
          ? JSON.stringify(formattedAddKeys) as unknown as unknown[]
          : undefined,
        disablePublicKeyIds: disablePublicKeyIds.length > 0
          ? disablePublicKeyIds
          : undefined,
      }),
      retryOptions
    );

    console.log('Update result:', result);

    return { success: true };
  } catch (error) {
    console.error('Identity update error:', error);
    // WasmSdkError is not a standard Error, so check for message property
    const errorMessage = (error && typeof error === 'object' && 'message' in error)
      ? String((error as { message: unknown }).message)
      : (error instanceof Error ? error.message : String(error));
    return {
      success: false,
      error: errorMessage,
    };
  }
}
