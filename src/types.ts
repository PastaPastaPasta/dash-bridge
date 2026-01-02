export interface KeyPair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

export interface UTXO {
  txid: string;
  vout: number;
  satoshis: number;
  scriptPubKey: string;
  confirmations: number;
}

export interface TxInfo {
  txid: string;
  confirmations: number;
  txlock?: boolean;
}

export interface PublicKeyInfo {
  id: number;
  type: number;
  purpose: number;
  securityLevel: number;
  data: string;
  readOnly: boolean;
}

/**
 * Key types supported by Dash Platform
 */
export type KeyType = 'ECDSA_SECP256K1' | 'ECDSA_HASH160';

/**
 * Key purposes supported by Dash Platform
 */
export type KeyPurpose = 'AUTHENTICATION' | 'TRANSFER' | 'VOTING' | 'OWNER';

/**
 * Security levels supported by Dash Platform
 */
export type SecurityLevel = 'MASTER' | 'CRITICAL' | 'HIGH' | 'MEDIUM';

/**
 * Configuration for a single identity key
 */
export interface IdentityKeyConfig {
  id: number;
  name: string;
  keyType: KeyType;
  purpose: KeyPurpose;
  securityLevel: SecurityLevel;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  privateKeyHex: string;
  privateKeyWif: string;
  publicKeyHex: string;
  /** Base64 data for SDK - full pubkey for SECP256K1, hash160 for ECDSA_HASH160 */
  dataBase64: string;
  /** HD derivation path (e.g., "m/9'/5'/5'/0'/0'/0'/0'") */
  derivationPath?: string;
}

/**
 * Bridge operation mode
 */
export type BridgeMode = 'create' | 'topup';

export type BridgeStep =
  | 'init'
  | 'configure_keys'
  | 'enter_identity'      // Top-up: user enters identity ID
  | 'generating_keys'
  | 'awaiting_deposit'
  | 'detecting_deposit'
  | 'building_transaction'
  | 'signing_transaction'
  | 'broadcasting'
  | 'waiting_islock'
  | 'registering_identity'
  | 'topping_up'          // Top-up: calling sdk.identities.topUp()
  | 'complete'
  | 'error';

export interface BridgeState {
  step: BridgeStep;
  network: 'testnet' | 'mainnet';
  /** Bridge operation mode */
  mode: BridgeMode;
  /** BIP39 mnemonic (12 words) for HD key derivation */
  mnemonic?: string;
  assetLockKeyPair?: KeyPair;
  /** Configurable identity keys */
  identityKeys: IdentityKeyConfig[];
  depositAddress?: string;
  detectedUtxo?: UTXO;
  depositAmount?: bigint;
  signedTxHex?: string;
  txid?: string;
  instantLockBytes?: Uint8Array;
  assetLockProof?: string;
  identityId?: string;
  error?: Error;
  /** True when deposit detection timed out and needs manual recheck */
  depositTimedOut?: boolean;
  /** Current detected deposit amount (may be below minimum) */
  detectedDepositAmount?: number;
  /** Target identity ID for top-up (user-provided) */
  targetIdentityId?: string;
  /** Whether asset lock key is a one-time random key (for top-up) vs HD-derived */
  isOneTimeKey?: boolean;
}
