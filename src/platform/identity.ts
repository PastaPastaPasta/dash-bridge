import { EvoSDK } from '@dashevo/evo-sdk';
import type { PublicKeyInfo, IdentityKeyConfig } from '../types.js';

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
  network: 'testnet' | 'mainnet'
): Promise<{ identityId: string; balance: number; revision: number }> {
  // Initialize SDK for the target network
  const sdk = network === 'mainnet'
    ? EvoSDK.mainnet()
    : EvoSDK.testnet();

  // Connect to the network
  console.log(`Connecting to ${network}...`);
  await sdk.connect();
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
  const identity = await sdk.identities.create({
    assetLockProof,
    assetLockPrivateKeyWif,
    publicKeys: JSON.stringify(publicKeysForSdk) as unknown as unknown[],
  });

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
  network: 'testnet' | 'mainnet'
): Promise<{ success: boolean; balance?: number }> {
  // Initialize SDK for the target network (trusted mode required for identity fetch)
  const sdk = network === 'mainnet'
    ? EvoSDK.mainnetTrusted()
    : EvoSDK.testnetTrusted();

  // Connect to the network
  console.log(`Connecting to ${network}...`);
  await sdk.connect();
  console.log('Connected to Platform');

  console.log('Topping up identity:', identityId);
  const result = await sdk.identities.topUp({
    identityId,
    assetLockProof,
    assetLockPrivateKeyWif,
  });

  console.log('Top-up result:', result);

  return {
    success: true,
    balance: result.balance || undefined,
  };
}
