import { getNetwork } from './config.js';
import { publicKeyToAddress, signTransaction, generateKeyPair } from './crypto/index.js';
import { deriveAssetLockKeyPair } from './crypto/hd.js';
import { createAssetLockTransaction, serializeTransaction } from './transaction/index.js';
import { InsightClient } from './api/insight.js';
import { DAPIClient } from './api/dapi.js';
import { buildInstantAssetLockProof } from './proof/index.js';
import { registerIdentity, topUpIdentity } from './platform/index.js';
import { privateKeyToWif, bytesToHex } from './utils/index.js';
import {
  createInitialState,
  setStep,
  setKeyPairs,
  setMode,
  setTargetIdentityId,
  setOneTimeKeyPair,
  setTopUpComplete,
  setUtxoDetected,
  setTransactionSigned,
  setTransactionBroadcast,
  setInstantLockReceived,
  setIdentityRegistered,
  setError,
  setDepositTimedOut,
  setNetwork,
  updateIdentityKey,
  addIdentityKey,
  removeIdentityKey,
  render,
  downloadKeyBackup,
} from './ui/index.js';
import type { KeyType, KeyPurpose, SecurityLevel } from './types.js';
import type { BridgeState } from './types.js';

// Global state
let state: BridgeState;
let insightClient: InsightClient;
let dapiClient: DAPIClient;

/**
 * Initialize the application
 */
function init() {
  // Get network from URL or default to testnet
  const urlParams = new URLSearchParams(window.location.search);
  const network = urlParams.get('network') === 'mainnet' ? 'mainnet' : 'testnet';

  // Initialize state
  state = createInitialState(network);
  insightClient = new InsightClient(getNetwork(network));
  dapiClient = new DAPIClient({ network });

  // Render UI
  const container = document.getElementById('app');
  if (container) {
    render(state, container);
    setupEventListeners(container);
  }
}

/**
 * Update state and re-render
 */
function updateState(newState: BridgeState) {
  state = newState;
  const container = document.getElementById('app');
  if (container) {
    render(state, container);
    setupEventListeners(container);
  }
}

/**
 * Setup event listeners
 */
function setupEventListeners(container: HTMLElement) {
  // Network selector buttons
  container.querySelectorAll('.network-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const network = (btn as HTMLElement).dataset.network as 'testnet' | 'mainnet';
      if (network && network !== state.network) {
        // Update state and reinitialize clients for new network
        updateState(setNetwork(state, network));
        insightClient = new InsightClient(getNetwork(network));
        dapiClient = new DAPIClient({ network });
      }
    });
  });

  // Mode selection buttons (init page)
  const modeCreateBtn = container.querySelector('#mode-create-btn');
  if (modeCreateBtn) {
    modeCreateBtn.addEventListener('click', () => {
      updateState(setMode(state, 'create'));
    });
  }

  const modeTopUpBtn = container.querySelector('#mode-topup-btn');
  if (modeTopUpBtn) {
    modeTopUpBtn.addEventListener('click', () => {
      updateState(setMode(state, 'topup'));
    });
  }

  // Back button (configure keys or enter identity -> init)
  const backBtn = container.querySelector('#back-btn');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      updateState(setStep(state, 'init'));
    });
  }

  // Identity ID input (for top-up mode)
  const identityInput = container.querySelector('#identity-id-input') as HTMLInputElement;
  if (identityInput) {
    identityInput.addEventListener('input', (e) => {
      const value = (e.target as HTMLInputElement).value.trim();
      updateState(setTargetIdentityId(state, value));
    });
  }

  // Continue top-up button
  const continueTopUpBtn = container.querySelector('#continue-topup-btn');
  if (continueTopUpBtn) {
    continueTopUpBtn.addEventListener('click', () => {
      if (validateIdentityId(state.targetIdentityId)) {
        startTopUp();
      } else {
        showValidationError('Please enter a valid identity ID (44 character Base58 string)');
      }
    });
  }

  // Continue button (configure keys -> start bridge)
  const continueBtn = container.querySelector('#continue-btn');
  if (continueBtn) {
    continueBtn.addEventListener('click', startBridge);
  }

  // Recheck deposit button
  const recheckBtn = container.querySelector('#recheck-deposit-btn');
  if (recheckBtn) {
    recheckBtn.addEventListener('click', recheckDeposit);
  }

  // Copy buttons
  container.querySelectorAll('.copy-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const text = (btn as HTMLElement).dataset.copy || '';
      navigator.clipboard.writeText(text);
      btn.textContent = 'Copied!';
      setTimeout(() => {
        btn.textContent = 'Copy';
      }, 2000);
    });
  });

  // Download keys button
  const downloadBtn = container.querySelector('#download-keys-btn');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', () => {
      downloadKeyBackup(state);
    });
  }

  // Retry button
  const retryBtn = container.querySelector('#retry-btn');
  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      updateState(createInitialState(state.network));
    });
  }

  // Add key button
  const addKeyBtn = container.querySelector('#add-key-btn');
  if (addKeyBtn) {
    addKeyBtn.addEventListener('click', () => {
      updateState(addIdentityKey(state));
    });
  }

  // Remove key buttons
  container.querySelectorAll('.remove-key-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const keyId = parseInt((btn as HTMLElement).dataset.keyId || '0', 10);
      updateState(removeIdentityKey(state, keyId));
    });
  });

  // Key type selects
  container.querySelectorAll('.key-type-select').forEach((select) => {
    select.addEventListener('change', (e) => {
      const target = e.target as HTMLSelectElement;
      const keyId = parseInt(target.dataset.keyId || '0', 10);
      updateState(updateIdentityKey(state, keyId, { keyType: target.value as KeyType }));
    });
  });

  // Key purpose selects
  container.querySelectorAll('.key-purpose-select').forEach((select) => {
    select.addEventListener('change', (e) => {
      const target = e.target as HTMLSelectElement;
      const keyId = parseInt(target.dataset.keyId || '0', 10);
      updateState(updateIdentityKey(state, keyId, { purpose: target.value as KeyPurpose }));
    });
  });

  // Key security level selects
  container.querySelectorAll('.key-security-select').forEach((select) => {
    select.addEventListener('change', (e) => {
      const target = e.target as HTMLSelectElement;
      const keyId = parseInt(target.dataset.keyId || '0', 10);
      updateState(updateIdentityKey(state, keyId, { securityLevel: target.value as SecurityLevel }));
    });
  });
}

/**
 * Validate identity ID format (Base58, ~44 characters)
 */
function validateIdentityId(id?: string): boolean {
  if (!id) return false;
  // Dash identity IDs are Base58 encoded, typically 43-44 characters
  return /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(id);
}

/**
 * Show validation error message in the UI
 */
function showValidationError(message: string): void {
  const validationMsg = document.getElementById('validation-msg');
  if (validationMsg) {
    validationMsg.textContent = message;
    validationMsg.classList.remove('hidden');
  }
}

/**
 * Start the top-up process
 */
async function startTopUp() {
  try {
    const network = getNetwork(state.network);

    // Step 1: Generate random one-time key pair (NOT HD-derived)
    updateState(setStep(state, 'generating_keys'));

    const assetLockKeyPair = generateKeyPair();
    const depositAddress = publicKeyToAddress(assetLockKeyPair.publicKey, network);

    const stateWithKeys = setOneTimeKeyPair(state, assetLockKeyPair, depositAddress);
    updateState(stateWithKeys);

    // Auto-download key backup immediately for safety
    // CRITICAL: User must have this to recover funds if something goes wrong
    downloadKeyBackup(stateWithKeys);

    // Step 2: Wait for deposit
    updateState(setStep(stateWithKeys, 'detecting_deposit'));

    const minAmount = 300000; // 0.003 DASH minimum
    const depositResult = await insightClient.waitForUtxo(
      depositAddress,
      minAmount,
      120000, // 2 minutes before showing recheck button
      3000    // poll every 3 seconds
    );

    // Handle timeout - show recheck button with any detected amount
    if (!depositResult.utxo) {
      updateState(setDepositTimedOut(state, true, depositResult.totalAmount));
      return;
    }

    const utxo = depositResult.utxo;

    updateState(setUtxoDetected(state, utxo));

    // Step 3: Build transaction
    updateState(setStep(state, 'building_transaction'));

    const tx = createAssetLockTransaction(
      utxo,
      assetLockKeyPair.publicKey,
      BigInt(network.minFee)
    );

    // Step 4: Sign transaction
    updateState(setStep(state, 'signing_transaction'));

    const signedTx = await signTransaction(
      tx,
      [utxo],
      assetLockKeyPair.privateKey,
      assetLockKeyPair.publicKey
    );

    const signedTxBytes = serializeTransaction(signedTx);
    const signedTxHex = bytesToHex(signedTxBytes);

    updateState(setTransactionSigned(state, signedTxHex));

    // Step 5: Broadcast transaction
    const txid = await insightClient.broadcastTransaction(signedTxHex);

    updateState(setTransactionBroadcast(state, txid));

    // Step 6: Wait for InstantSend lock
    updateState(setStep(state, 'waiting_islock'));

    console.log('Waiting for InstantSend lock...');
    const islockBytes = await dapiClient.waitForInstantSendLock(txid, 60000);
    console.log('InstantSend lock received:', islockBytes.length, 'bytes');

    const assetLockProof = buildInstantAssetLockProof(
      signedTxBytes,
      islockBytes,
      0
    );

    updateState(setInstantLockReceived(state, islockBytes, assetLockProof));

    // Step 7: Top up identity (different from create)
    updateState(setStep(state, 'topping_up'));

    const assetLockPrivateKeyWif = privateKeyToWif(
      assetLockKeyPair.privateKey,
      network
    );

    await topUpIdentity(
      state.targetIdentityId!,
      assetLockProof,
      assetLockPrivateKeyWif,
      state.network
    );

    updateState(setTopUpComplete(state));

  } catch (error) {
    console.error('Top-up error:', error);
    updateState(setError(state, error instanceof Error ? error : new Error(String(error))));
  }
}

/**
 * Start the bridge process (identity creation)
 */
async function startBridge() {
  try {
    const network = getNetwork(state.network);

    // Ensure mnemonic exists
    if (!state.mnemonic) {
      throw new Error('No mnemonic available for HD derivation');
    }

    // Step 1: Derive asset lock key from mnemonic (identity keys are pre-configured in state)
    updateState(setStep(state, 'generating_keys'));

    const { privateKey, publicKey } = deriveAssetLockKeyPair(state.mnemonic, state.network);
    const assetLockKeyPair = { privateKey, publicKey };
    const depositAddress = publicKeyToAddress(assetLockKeyPair.publicKey, network);

    updateState(
      setKeyPairs(state, assetLockKeyPair, depositAddress)
    );

    // Auto-download key backup immediately for safety
    // This ensures users can recover funds if they reload the page
    downloadKeyBackup(state);

    // Step 2: Wait for deposit
    updateState(setStep(state, 'detecting_deposit'));

    const minAmount = 300000; // 0.003 DASH minimum
    const depositResult = await insightClient.waitForUtxo(
      depositAddress,
      minAmount,
      120000, // 2 minutes before showing recheck button
      3000    // poll every 3 seconds
    );

    // Handle timeout - show recheck button with any detected amount
    if (!depositResult.utxo) {
      updateState(setDepositTimedOut(state, true, depositResult.totalAmount));
      return;
    }

    const utxo = depositResult.utxo;

    updateState(setUtxoDetected(state, utxo));

    // Step 3: Build transaction
    updateState(setStep(state, 'building_transaction'));

    const tx = createAssetLockTransaction(
      utxo,
      assetLockKeyPair.publicKey,
      BigInt(network.minFee)
    );

    // Step 4: Sign transaction
    updateState(setStep(state, 'signing_transaction'));

    const signedTx = await signTransaction(
      tx,
      [utxo],
      assetLockKeyPair.privateKey,
      assetLockKeyPair.publicKey
    );

    const signedTxBytes = serializeTransaction(signedTx);
    const signedTxHex = bytesToHex(signedTxBytes);

    updateState(setTransactionSigned(state, signedTxHex));

    // Step 5: Broadcast transaction
    const txid = await insightClient.broadcastTransaction(signedTxHex);

    updateState(setTransactionBroadcast(state, txid));

    // Step 6: Wait for InstantSend lock
    updateState(setStep(state, 'waiting_islock'));

    console.log('Waiting for InstantSend lock...');
    const islockBytes = await dapiClient.waitForInstantSendLock(txid, 60000);
    console.log('InstantSend lock received:', islockBytes.length, 'bytes');

    const assetLockProof = buildInstantAssetLockProof(
      signedTxBytes,
      islockBytes,
      0
    );

    updateState(setInstantLockReceived(state, islockBytes, assetLockProof));

    // Step 7: Register identity
    updateState(setStep(state, 'registering_identity'));

    const assetLockPrivateKeyWif = privateKeyToWif(
      assetLockKeyPair.privateKey,
      network
    );

    const result = await registerIdentity(
      assetLockProof,
      assetLockPrivateKeyWif,
      state.identityKeys,
      state.network
    );

    updateState(setIdentityRegistered(state, result.identityId));

  } catch (error) {
    console.error('Bridge error:', error);
    updateState(setError(state, error instanceof Error ? error : new Error(String(error))));
  }
}

/**
 * Recheck for deposit (called when user clicks "Check Again" after timeout)
 */
async function recheckDeposit() {
  if (!state.depositAddress) {
    console.error('No deposit address available');
    return;
  }

  // Reset timeout state and start polling again
  updateState(setDepositTimedOut(state, false, 0));

  const minAmount = 300000; // 0.003 DASH minimum
  const depositResult = await insightClient.waitForUtxo(
    state.depositAddress,
    minAmount,
    120000, // 2 minutes before showing recheck button
    3000    // poll every 3 seconds
  );

  // Handle timeout - show recheck button again with any detected amount
  if (!depositResult.utxo) {
    updateState(setDepositTimedOut(state, true, depositResult.totalAmount));
    return;
  }

  const utxo = depositResult.utxo;

  // Continue with the rest of the bridge process
  try {
    const network = getNetwork(state.network);
    const assetLockKeyPair = state.assetLockKeyPair!;

    updateState(setUtxoDetected(state, utxo));

    // Step 3: Build transaction
    updateState(setStep(state, 'building_transaction'));

    const tx = createAssetLockTransaction(
      utxo,
      assetLockKeyPair.publicKey,
      BigInt(network.minFee)
    );

    // Step 4: Sign transaction
    updateState(setStep(state, 'signing_transaction'));

    const signedTx = await signTransaction(
      tx,
      [utxo],
      assetLockKeyPair.privateKey,
      assetLockKeyPair.publicKey
    );

    const signedTxBytes = serializeTransaction(signedTx);
    const signedTxHex = bytesToHex(signedTxBytes);

    updateState(setTransactionSigned(state, signedTxHex));

    // Step 5: Broadcast transaction
    const txid = await insightClient.broadcastTransaction(signedTxHex);

    updateState(setTransactionBroadcast(state, txid));

    // Step 6: Wait for InstantSend lock
    updateState(setStep(state, 'waiting_islock'));

    console.log('Waiting for InstantSend lock...');
    const islockBytes = await dapiClient.waitForInstantSendLock(txid, 60000);
    console.log('InstantSend lock received:', islockBytes.length, 'bytes');

    const assetLockProof = buildInstantAssetLockProof(
      signedTxBytes,
      islockBytes,
      0
    );

    updateState(setInstantLockReceived(state, islockBytes, assetLockProof));

    // Step 7: Register identity
    updateState(setStep(state, 'registering_identity'));

    const assetLockPrivateKeyWif = privateKeyToWif(
      assetLockKeyPair.privateKey,
      network
    );

    const result = await registerIdentity(
      assetLockProof,
      assetLockPrivateKeyWif,
      state.identityKeys,
      state.network
    );

    updateState(setIdentityRegistered(state, result.identityId));

  } catch (error) {
    console.error('Bridge error:', error);
    updateState(setError(state, error instanceof Error ? error : new Error(String(error))));
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
