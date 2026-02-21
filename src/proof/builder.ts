import type { AssetLockProofData } from '../types.js';

/**
 * Build an AssetLockProofData from transaction and instant lock bytes
 *
 * Returns the raw components needed by AssetLockProof.createInstantAssetLockProof()
 *
 * @param transactionBytes - Serialized signed transaction
 * @param instantLockBytes - Serialized InstantSend lock message
 * @param outputIndex - Index of the burn output (usually 0)
 * @returns Raw proof components for the SDK
 */
export function buildInstantAssetLockProof(
  transactionBytes: Uint8Array,
  instantLockBytes: Uint8Array,
  outputIndex: number = 0
): AssetLockProofData {
  return {
    transactionBytes,
    instantLockBytes,
    outputIndex,
  };
}
