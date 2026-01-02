import type {
  BridgeState,
  BridgeStep,
  BridgeMode,
  KeyPair,
  UTXO,
  IdentityKeyConfig,
} from '../types.js';
import {
  generateDefaultIdentityKeysHD,
  generateIdentityKeyFromMnemonic,
} from '../crypto/keys.js';
import { generateNewMnemonic } from '../crypto/hd.js';

/**
 * Create initial bridge state (mode selection)
 * Keys are generated when mode is selected, not at init
 */
export function createInitialState(network: 'testnet' | 'mainnet'): BridgeState {
  return {
    step: 'init',
    network,
    mode: 'create', // Default mode
    identityKeys: [],
  };
}

/**
 * State transition functions
 */
export function setStep(state: BridgeState, step: BridgeStep): BridgeState {
  return { ...state, step };
}

export function setKeyPairs(
  state: BridgeState,
  assetLockKeyPair: KeyPair,
  depositAddress: string
): BridgeState {
  return {
    ...state,
    step: 'awaiting_deposit',
    assetLockKeyPair,
    depositAddress,
  };
}

/**
 * Set bridge mode and transition to appropriate initial step
 */
export function setMode(state: BridgeState, mode: BridgeMode): BridgeState {
  if (mode === 'create') {
    // Create mode: generate mnemonic and identity keys
    const mnemonic = generateNewMnemonic(128);
    return {
      ...state,
      step: 'configure_keys',
      mode,
      mnemonic,
      identityKeys: generateDefaultIdentityKeysHD(state.network, mnemonic),
      // Clear any top-up state
      targetIdentityId: undefined,
      isOneTimeKey: undefined,
    };
  } else {
    // Top-up mode: no mnemonic, no identity keys
    return {
      ...state,
      step: 'enter_identity',
      mode,
      mnemonic: undefined,
      identityKeys: [],
      isOneTimeKey: true,
    };
  }
}

/**
 * Set target identity ID for top-up
 */
export function setTargetIdentityId(state: BridgeState, targetIdentityId: string): BridgeState {
  return {
    ...state,
    targetIdentityId,
  };
}

/**
 * Set one-time key pair for top-up (random, not HD-derived)
 */
export function setOneTimeKeyPair(
  state: BridgeState,
  assetLockKeyPair: KeyPair,
  depositAddress: string
): BridgeState {
  return {
    ...state,
    step: 'awaiting_deposit',
    assetLockKeyPair,
    depositAddress,
    isOneTimeKey: true,
  };
}

/**
 * Set top-up complete
 */
export function setTopUpComplete(state: BridgeState): BridgeState {
  return {
    ...state,
    step: 'complete',
    identityId: state.targetIdentityId, // Use target identity ID on completion
  };
}

/**
 * Update a specific identity key's configuration
 */
export function updateIdentityKey(
  state: BridgeState,
  keyId: number,
  updates: Partial<Pick<IdentityKeyConfig, 'keyType' | 'purpose' | 'securityLevel' | 'name'>>
): BridgeState {
  if (!state.mnemonic) {
    throw new Error('No mnemonic available for HD derivation');
  }

  const identityKeys = state.identityKeys.map((key, index) => {
    if (key.id !== keyId) return key;

    // If keyType changed, regenerate with new type using HD derivation
    if (updates.keyType && updates.keyType !== key.keyType) {
      return generateIdentityKeyFromMnemonic(
        key.id,
        updates.name ?? key.name,
        updates.keyType,
        updates.purpose ?? key.purpose,
        updates.securityLevel ?? key.securityLevel,
        state.network,
        state.mnemonic!,
        index // Use array index as key index
      );
    }

    return {
      ...key,
      ...updates,
    };
  });

  return { ...state, identityKeys };
}

/**
 * Add a new identity key using HD derivation
 */
export function addIdentityKey(state: BridgeState): BridgeState {
  if (!state.mnemonic) {
    throw new Error('No mnemonic available for HD derivation');
  }

  const nextId = Math.max(...state.identityKeys.map((k) => k.id)) + 1;
  const keyIndex = state.identityKeys.length; // Use array length as key index

  const newKey = generateIdentityKeyFromMnemonic(
    nextId,
    `Key ${nextId}`,
    'ECDSA_SECP256K1',
    'AUTHENTICATION',
    'HIGH',
    state.network,
    state.mnemonic,
    keyIndex
  );

  return {
    ...state,
    identityKeys: [...state.identityKeys, newKey],
  };
}

/**
 * Remove an identity key
 */
export function removeIdentityKey(state: BridgeState, keyId: number): BridgeState {
  // Don't allow removing the last key
  if (state.identityKeys.length <= 1) return state;

  return {
    ...state,
    identityKeys: state.identityKeys.filter((k) => k.id !== keyId),
  };
}

/**
 * Regenerate all identity keys from mnemonic (re-derives with same paths)
 */
export function regenerateAllIdentityKeys(state: BridgeState): BridgeState {
  if (!state.mnemonic) {
    throw new Error('No mnemonic available for HD derivation');
  }

  const identityKeys = state.identityKeys.map((key, index) =>
    generateIdentityKeyFromMnemonic(
      key.id,
      key.name,
      key.keyType,
      key.purpose,
      key.securityLevel,
      state.network,
      state.mnemonic!,
      index
    )
  );

  return { ...state, identityKeys };
}

export function setUtxoDetected(state: BridgeState, utxo: UTXO): BridgeState {
  return {
    ...state,
    step: 'building_transaction',
    detectedUtxo: utxo,
    depositAmount: BigInt(utxo.satoshis),
  };
}

export function setTransactionSigned(
  state: BridgeState,
  signedTxHex: string
): BridgeState {
  return {
    ...state,
    step: 'broadcasting',
    signedTxHex,
  };
}

export function setTransactionBroadcast(
  state: BridgeState,
  txid: string
): BridgeState {
  return {
    ...state,
    step: 'waiting_islock',
    txid,
  };
}

export function setInstantLockReceived(
  state: BridgeState,
  instantLockBytes: Uint8Array,
  assetLockProof: string
): BridgeState {
  return {
    ...state,
    step: 'registering_identity',
    instantLockBytes,
    assetLockProof,
  };
}

export function setIdentityRegistered(
  state: BridgeState,
  identityId: string
): BridgeState {
  return {
    ...state,
    step: 'complete',
    identityId,
  };
}

export function setError(state: BridgeState, error: Error): BridgeState {
  return {
    ...state,
    step: 'error',
    error,
  };
}

/**
 * Set network (re-derives identity keys for new network from same mnemonic)
 */
export function setNetwork(
  state: BridgeState,
  network: 'testnet' | 'mainnet'
): BridgeState {
  if (!state.mnemonic) {
    // Fallback: generate new mnemonic if none exists
    const mnemonic = generateNewMnemonic(128);
    return {
      ...state,
      network,
      mnemonic,
      identityKeys: generateDefaultIdentityKeysHD(network, mnemonic),
    };
  }

  // Re-derive keys with same mnemonic for new network (derivation paths change)
  const identityKeys = state.identityKeys.map((key, index) =>
    generateIdentityKeyFromMnemonic(
      key.id,
      key.name,
      key.keyType,
      key.purpose,
      key.securityLevel,
      network,
      state.mnemonic!,
      index
    )
  );

  return {
    ...state,
    network,
    identityKeys,
  };
}

/**
 * Set deposit timeout state (shows recheck button when true)
 */
export function setDepositTimedOut(
  state: BridgeState,
  timedOut: boolean,
  detectedAmount?: number
): BridgeState {
  return {
    ...state,
    depositTimedOut: timedOut,
    detectedDepositAmount: detectedAmount,
  };
}

/**
 * Get human-readable step description
 */
export function getStepDescription(step: BridgeStep): string {
  const descriptions: Record<BridgeStep, string> = {
    init: 'Ready to start',
    configure_keys: 'Configure your keys',
    enter_identity: 'Top up identity',
    generating_keys: 'Setting up...',
    awaiting_deposit: 'Fund your identity',
    detecting_deposit: 'Fund your identity',
    building_transaction: 'Preparing transaction...',
    signing_transaction: 'Signing...',
    broadcasting: 'Submitting to network...',
    waiting_islock: 'Confirming...',
    registering_identity: 'Creating identity...',
    topping_up: 'Adding credits...',
    complete: 'Complete',
    error: 'Something went wrong',
  };
  return descriptions[step];
}

/**
 * Get progress percentage for background progress bar (0-100)
 */
export function getStepProgress(step: BridgeStep): number {
  const progress: Record<BridgeStep, number> = {
    init: 0,
    configure_keys: 10,
    enter_identity: 10,
    generating_keys: 20,
    awaiting_deposit: 30,
    detecting_deposit: 30,
    building_transaction: 50,
    signing_transaction: 60,
    broadcasting: 70,
    waiting_islock: 80,
    registering_identity: 90,
    topping_up: 90,
    complete: 100,
    error: 0,
  };
  return progress[step];
}

/**
 * Check if the current step is a loading/processing step
 */
export function isProcessingStep(step: BridgeStep): boolean {
  const processingSteps: BridgeStep[] = [
    'generating_keys',
    // detecting_deposit is NOT a processing step - it's waiting for user action
    'building_transaction',
    'signing_transaction',
    'broadcasting',
    'waiting_islock',
    'registering_identity',
    'topping_up',
  ];
  return processingSteps.includes(step);
}
