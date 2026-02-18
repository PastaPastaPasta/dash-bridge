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
export type KeyPurpose = 'AUTHENTICATION' | 'ENCRYPTION' | 'TRANSFER' | 'VOTING' | 'OWNER';

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
export type BridgeMode = 'create' | 'topup' | 'fund_address' | 'dpns' | 'manage';

/**
 * DPNS identity source for standalone mode
 */
export type DpnsIdentitySource = 'new' | 'existing';

/**
 * Status of a DPNS username entry during the flow
 */
export type DpnsUsernameStatus = 'pending' | 'checking' | 'available' | 'taken' | 'invalid';

/**
 * DPNS username entry with validation/availability status
 */
export interface DpnsUsernameEntry {
  /** Raw user input (e.g., "alice") */
  label: string;
  /** Homograph-safe version (e.g., "a11ce") */
  normalizedLabel: string;
  /** Passes DPNS validation rules */
  isValid: boolean;
  /** If invalid, why */
  validationError?: string;
  /** null = unchecked, true/false = checked */
  isAvailable?: boolean;
  /** 3-19 chars, only [a-z, 0, 1, -] after normalization */
  isContested?: boolean;
  /** Current status in the flow */
  status: DpnsUsernameStatus;
}

/**
 * DPNS registration result for a single name
 */
export interface DpnsRegistrationResult {
  label: string;
  success: boolean;
  error?: string;
  /** If contested, voting required */
  isContested: boolean;
}

/**
 * Public key info fetched from an identity on the network
 */
export interface IdentityPublicKeyInfo {
  id: number;
  type: number;
  purpose: number;
  securityLevel: number;
  data: Uint8Array;
  /** Whether the key is disabled */
  isDisabled?: boolean;
}

/**
 * Configuration for a new key to add during identity update
 */
export interface ManageNewKeyConfig {
  /** Temporary ID for UI tracking (not the final on-chain ID) */
  tempId: string;
  keyType: KeyType;
  purpose: KeyPurpose;
  securityLevel: SecurityLevel;
  /** 'generate' = create new random key, 'import' = user provides public key */
  source: 'generate' | 'import';
  /** For generated keys: the generated key data */
  generatedKey?: {
    privateKey: Uint8Array;
    publicKey: Uint8Array;
    privateKeyHex: string;
    privateKeyWif: string;
    publicKeyHex: string;
  };
  /** For imported keys: base64-encoded public key data */
  importedPublicKeyBase64?: string;
}

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
  | 'enter_platform_address'  // Fund address: user enters platform address private key
  | 'funding_address'         // Fund address: calling sdk.addresses.fundFromAssetLock()
  | 'complete'
  | 'error'
  // DPNS username registration steps
  | 'dpns_choose_identity'    // Choose: create new or use existing
  | 'dpns_enter_identity'     // Enter existing identity ID + private key
  | 'dpns_enter_usernames'    // Enter username(s)
  | 'dpns_checking'           // Check availability
  | 'dpns_review'             // Review with contested warning
  | 'dpns_registering'        // Registration in progress
  | 'dpns_complete'           // Done
  // Identity Management steps
  | 'manage_enter_identity'   // Enter identity ID + private key WIF
  | 'manage_view_keys'        // Display current keys, configure changes
  | 'manage_updating'         // Update transition in progress
  | 'manage_complete';        // Update complete

/**
 * Status of network retry attempts
 */
export interface RetryStatus {
  /** Whether a retry is currently in progress */
  isRetrying: boolean;
  /** Current retry attempt number (1-indexed) */
  attempt: number;
  /** Maximum number of retry attempts */
  maxAttempts: number;
  /** Error message from the last failed attempt */
  lastError?: string;
}

export interface BridgeState {
  step: BridgeStep;
  network: 'testnet' | 'mainnet';
  /** Bridge operation mode */
  mode: BridgeMode;
  /** Current network retry status (for displaying retry indicator) */
  retryStatus?: RetryStatus;
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
  /** Whether asset lock key is a one-time random key (for top-up/fund_address) vs HD-derived */
  isOneTimeKey?: boolean;

  // Fund Platform Address fields
  /** Fund address: WIF of user's platform address key */
  platformAddressPrivateKeyWif?: string;
  /** Fund address: derived bech32m platform address (for display) */
  platformAddress?: string;

  // DPNS username registration fields
  /** DPNS: usernames to register */
  dpnsUsernames?: DpnsUsernameEntry[];
  /** DPNS: registration results */
  dpnsResults?: DpnsRegistrationResult[];
  /** DPNS: whether user came from identity creation complete screen */
  dpnsFromIdentityCreation?: boolean;
  /** DPNS: identity source for standalone mode */
  dpnsIdentitySource?: DpnsIdentitySource;
  /** DPNS: private key WIF for existing identity (user-provided) */
  dpnsPrivateKeyWif?: string;
  /** DPNS: public key ID to use for registration */
  dpnsPublicKeyId?: number;
  /** DPNS: all contested names warning acknowledged */
  dpnsContestedWarningAcknowledged?: boolean;
  /** DPNS: current registration progress (index) */
  dpnsRegistrationProgress?: number;
  /** DPNS: fetched identity public keys */
  dpnsIdentityKeys?: IdentityPublicKeyInfo[];
  /** DPNS: whether identity is being fetched */
  dpnsIdentityFetching?: boolean;
  /** DPNS: error message if identity fetch failed */
  dpnsIdentityFetchError?: string;
  /** DPNS: validated key ID (auto-detected from private key) */
  dpnsValidatedKeyId?: number;
  /** DPNS: key validation error message */
  dpnsKeyValidationError?: string;

  // Identity Management fields
  /** Manage: keys to add during update operation */
  manageKeysToAdd?: ManageNewKeyConfig[];
  /** Manage: key IDs to disable during update operation */
  manageKeyIdsToDisable?: number[];
  /** Manage: private key WIF for signing update transition */
  managePrivateKeyWif?: string;
  /** Manage: validated signing key info */
  manageSigningKeyInfo?: { keyId: number; securityLevel: number };
  /** Manage: identity fetching state */
  manageIdentityFetching?: boolean;
  /** Manage: identity fetch error */
  manageIdentityFetchError?: string;
  /** Manage: fetched identity keys */
  manageIdentityKeys?: IdentityPublicKeyInfo[];
  /** Manage: update result */
  manageUpdateResult?: { success: boolean; error?: string };
  /** Manage: key validation error message */
  manageKeyValidationError?: string;

  // Faucet request state
  /** Current status of faucet request */
  faucetRequestStatus?: 'idle' | 'solving_pow' | 'requesting' | 'success' | 'error';
  /** Transaction ID from successful faucet request */
  faucetTxid?: string;
  /** Error message from failed faucet request */
  faucetError?: string;
}
