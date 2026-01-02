import type { BridgeState, KeyType, KeyPurpose, SecurityLevel } from '../types.js';
import { getStepProgress } from './state.js';
import { generateQRCodeDataUrl } from './qrcode.js';
import { privateKeyToWif } from '../utils/wif.js';
import { bytesToHex } from '../utils/hex.js';
import { getNetwork } from '../config.js';
import { getAssetLockDerivationPath } from '../crypto/hd.js';

// Available options for key configuration
const KEY_TYPES: KeyType[] = ['ECDSA_SECP256K1', 'ECDSA_HASH160'];
const KEY_PURPOSES: KeyPurpose[] = ['AUTHENTICATION', 'TRANSFER', 'VOTING', 'OWNER'];
const SECURITY_LEVELS: SecurityLevel[] = ['MASTER', 'CRITICAL', 'HIGH', 'MEDIUM'];

/**
 * Render the main application UI
 */
export function render(state: BridgeState, container: HTMLElement): void {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'bridge-container';

  // Subtle progress bar at top
  const progress = getStepProgress(state.step);
  if (progress > 0) {
    const progressBar = document.createElement('div');
    progressBar.className = 'progress-bar';
    progressBar.innerHTML = `<div class="progress-fill" style="width: ${progress}%"></div>`;
    wrapper.appendChild(progressBar);
  }

  // Header
  const header = document.createElement('header');
  header.innerHTML = `
    <h1>Dash Core → Platform Bridge</h1>
    <p class="network-badge ${state.network}">${state.network.toUpperCase()}</p>
  `;
  wrapper.appendChild(header);


  // Content based on step
  const content = document.createElement('div');
  content.className = 'content';

  switch (state.step) {
    case 'init':
      content.appendChild(renderInitStep(state));
      break;

    case 'configure_keys':
      content.appendChild(renderConfigureKeysStep(state));
      break;

    case 'enter_identity':
      content.appendChild(renderEnterIdentityStep(state));
      break;

    case 'awaiting_deposit':
    case 'detecting_deposit':
      content.appendChild(renderDepositStep(state));
      break;

    case 'building_transaction':
    case 'signing_transaction':
    case 'broadcasting':
    case 'waiting_islock':
    case 'registering_identity':
    case 'topping_up':
      content.appendChild(renderProcessingStep(state));
      break;

    case 'complete':
      content.appendChild(renderCompleteStep(state));
      break;

    case 'error':
      content.appendChild(renderErrorStep(state));
      break;
  }

  wrapper.appendChild(content);
  container.appendChild(wrapper);
}

function renderInitStep(state: BridgeState): HTMLElement {
  const div = document.createElement('div');
  div.className = 'init-step mode-selection';

  // Intro text
  const intro = document.createElement('div');
  intro.className = 'intro';
  intro.innerHTML = `
    <p>What would you like to do?</p>
    <p class="intro-secondary">All cryptographic operations happen in your browser.</p>
  `;
  div.appendChild(intro);

  // Network selector
  const networkSelector = document.createElement('div');
  networkSelector.className = 'network-selector';
  networkSelector.innerHTML = `
    <button class="network-btn testnet ${state.network === 'testnet' ? 'active' : ''}" data-network="testnet">Testnet</button>
    <button class="network-btn mainnet ${state.network === 'mainnet' ? 'active' : ''}" data-network="mainnet">Mainnet</button>
  `;
  div.appendChild(networkSelector);

  // Mode selection buttons
  const modeButtons = document.createElement('div');
  modeButtons.className = 'mode-buttons';
  modeButtons.innerHTML = `
    <button id="mode-create-btn" class="mode-btn primary-btn">
      <span class="mode-label">Create New Identity</span>
      <span class="mode-desc">Generate keys and register a new identity</span>
    </button>
    <button id="mode-topup-btn" class="mode-btn secondary-btn">
      <span class="mode-label">Top Up Existing Identity</span>
      <span class="mode-desc">Add credits to an identity you already own</span>
    </button>
  `;
  div.appendChild(modeButtons);

  return div;
}

function renderConfigureKeysStep(state: BridgeState): HTMLElement {
  const div = document.createElement('div');
  div.className = 'configure-keys-step';

  // Reassurance about defaults
  const reassurance = document.createElement('div');
  reassurance.className = 'keys-reassurance';
  reassurance.innerHTML = `
    <p class="keys-reassurance-text">These defaults are recommended. You don't need to change anything.</p>
  `;
  div.appendChild(reassurance);

  // Key configuration section
  const keysSection = document.createElement('div');
  keysSection.className = 'keys-section';

  // Keys list
  const keysList = document.createElement('div');
  keysList.className = 'keys-list';

  state.identityKeys.forEach((key) => {
    const keyRow = document.createElement('div');
    keyRow.className = 'key-row';
    keyRow.dataset.keyId = String(key.id);

    keyRow.innerHTML = `
      <div class="key-name">${key.name}</div>
      <div class="key-config">
        <select class="key-type-select" data-key-id="${key.id}">
          ${KEY_TYPES.map((t) => `<option value="${t}" ${t === key.keyType ? 'selected' : ''}>${t.replace('ECDSA_', '')}</option>`).join('')}
        </select>
        <select class="key-purpose-select" data-key-id="${key.id}">
          ${KEY_PURPOSES.map((p) => `<option value="${p}" ${p === key.purpose ? 'selected' : ''}>${p.substring(0, 6)}</option>`).join('')}
        </select>
        <select class="key-security-select" data-key-id="${key.id}">
          ${SECURITY_LEVELS.map((s) => `<option value="${s}" ${s === key.securityLevel ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
        <button class="remove-key-btn" data-key-id="${key.id}" ${state.identityKeys.length <= 1 ? 'disabled' : ''}>×</button>
      </div>
    `;

    keysList.appendChild(keyRow);
  });

  keysSection.appendChild(keysList);

  // Add key button
  const addKeyBtn = document.createElement('button');
  addKeyBtn.id = 'add-key-btn';
  addKeyBtn.className = 'add-key-btn';
  addKeyBtn.textContent = '+ Add Key';
  keysSection.appendChild(addKeyBtn);

  div.appendChild(keysSection);

  // Navigation buttons
  const navButtons = document.createElement('div');
  navButtons.className = 'nav-buttons';

  const backBtn = document.createElement('button');
  backBtn.id = 'back-btn';
  backBtn.className = 'secondary-btn';
  backBtn.textContent = 'Back';
  navButtons.appendChild(backBtn);

  const continueBtn = document.createElement('button');
  continueBtn.id = 'continue-btn';
  continueBtn.className = 'primary-btn';
  continueBtn.textContent = 'Continue';
  navButtons.appendChild(continueBtn);

  div.appendChild(navButtons);

  return div;
}

function renderEnterIdentityStep(state: BridgeState): HTMLElement {
  const div = document.createElement('div');
  div.className = 'enter-identity-step';

  // Identity ID input
  const inputSection = document.createElement('div');
  inputSection.className = 'identity-input-section';
  inputSection.innerHTML = `
    <label class="input-label">Identity ID</label>
    <input
      type="text"
      id="identity-id-input"
      class="identity-id-input"
      placeholder="Paste your identity ID here..."
      value="${state.targetIdentityId || ''}"
    />
    <p class="input-hint">The 44-character Base58 identifier for your existing identity</p>
  `;
  div.appendChild(inputSection);

  // Validation message placeholder
  const validationMsg = document.createElement('p');
  validationMsg.id = 'validation-msg';
  validationMsg.className = 'validation-msg hidden';
  div.appendChild(validationMsg);

  // Navigation buttons
  const navButtons = document.createElement('div');
  navButtons.className = 'nav-buttons';

  const backBtn = document.createElement('button');
  backBtn.id = 'back-btn';
  backBtn.className = 'secondary-btn';
  backBtn.textContent = 'Back';
  navButtons.appendChild(backBtn);

  const continueBtn = document.createElement('button');
  continueBtn.id = 'continue-topup-btn';
  continueBtn.className = 'primary-btn';
  continueBtn.textContent = 'Continue';
  navButtons.appendChild(continueBtn);

  div.appendChild(navButtons);

  return div;
}

function renderDepositStep(state: BridgeState): HTMLElement {
  const div = document.createElement('div');
  div.className = `deposit-step ${state.mode === 'topup' ? 'topup-deposit' : ''}`;

  const address = state.depositAddress || '';
  const isTopUp = state.mode === 'topup';

  // Primary instruction - mode-aware headline
  const headline = document.createElement('h2');
  headline.className = 'deposit-headline';
  if (isTopUp && state.targetIdentityId) {
    // Truncate identity ID for display
    const truncatedId = state.targetIdentityId.length > 12
      ? `${state.targetIdentityId.slice(0, 8)}...${state.targetIdentityId.slice(-4)}`
      : state.targetIdentityId;
    headline.innerHTML = `Top up <code class="inline-id">${truncatedId}</code>`;
  } else {
    headline.innerHTML = 'Send at least <strong>0.003 DASH</strong>';
  }
  div.appendChild(headline);

  // Amount instruction for top-up mode (separate line)
  if (isTopUp) {
    const amountInstruction = document.createElement('p');
    amountInstruction.className = 'deposit-instruction';
    amountInstruction.innerHTML = 'Send at least <strong>0.003 DASH</strong>';
    div.appendChild(amountInstruction);
  }

  // Secondary reassurance - single place for "we'll continue" message
  const reassurance = document.createElement('p');
  reassurance.className = 'deposit-reassurance';
  reassurance.textContent = "We'll continue automatically once detected.";
  div.appendChild(reassurance);

  // QR section with prominent label
  const qrSection = document.createElement('div');
  qrSection.className = 'qr-section';

  const qrLabel = document.createElement('p');
  qrLabel.className = 'qr-label';
  qrLabel.textContent = 'Scan to send';
  qrSection.appendChild(qrLabel);

  const qrContainer = document.createElement('div');
  qrContainer.className = 'qr-container';
  qrContainer.innerHTML = '<div class="qr-loading">Loading...</div>';
  qrSection.appendChild(qrContainer);

  // Generate QR code asynchronously
  generateQRCodeDataUrl(address, 180).then((dataUrl) => {
    const img = document.createElement('img');
    img.src = dataUrl;
    img.alt = 'Deposit Address QR Code';
    img.width = 180;
    img.height = 180;
    qrContainer.innerHTML = '';
    qrContainer.appendChild(img);
  }).catch((err) => {
    console.error('QR code generation failed:', err);
    qrContainer.innerHTML = '<div class="qr-error">QR failed</div>';
  });

  div.appendChild(qrSection);

  // Mnemonic display section
  if (state.mnemonic) {
    const mnemonicSection = document.createElement('div');
    mnemonicSection.className = 'mnemonic-section';

    const mnemonicHeader = document.createElement('div');
    mnemonicHeader.className = 'mnemonic-header';
    mnemonicHeader.innerHTML = '<strong>Recovery Phrase</strong>';
    mnemonicSection.appendChild(mnemonicHeader);

    const mnemonicWarning = document.createElement('p');
    mnemonicWarning.className = 'mnemonic-warning';
    mnemonicWarning.textContent = 'Write down these 12 words in order. This is the only way to recover your keys.';
    mnemonicSection.appendChild(mnemonicWarning);

    const words = state.mnemonic.split(' ');
    const mnemonicWords = document.createElement('div');
    mnemonicWords.className = 'mnemonic-words';
    mnemonicWords.innerHTML = words.map((word, i) =>
      `<span class="mnemonic-word"><span class="word-num">${i + 1}.</span> ${word}</span>`
    ).join('');
    mnemonicSection.appendChild(mnemonicWords);

    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-btn mnemonic-copy';
    copyBtn.dataset.copy = state.mnemonic;
    copyBtn.textContent = 'Copy Phrase';
    mnemonicSection.appendChild(copyBtn);

    div.appendChild(mnemonicSection);
  }

  // Address with copy
  const addressSection = document.createElement('div');
  addressSection.className = 'address-section';

  const addressLabel = document.createElement('p');
  addressLabel.className = 'address-label';
  addressLabel.textContent = 'Or copy the address';
  addressSection.appendChild(addressLabel);

  const addressDisplay = document.createElement('div');
  addressDisplay.className = 'address-display';
  addressDisplay.innerHTML = `
    <code class="address">${address}</code>
    <button class="copy-btn" data-copy="${address}">Copy</button>
  `;
  addressSection.appendChild(addressDisplay);

  div.appendChild(addressSection);

  // Recheck section only shown after timeout
  if (state.step === 'detecting_deposit' && state.depositTimedOut) {
    const recheckSection = document.createElement('div');
    recheckSection.className = 'recheck-section';

    const detectedAmount = state.detectedDepositAmount || 0;
    const detectedDash = (detectedAmount / 100_000_000).toFixed(4);

    if (detectedAmount > 0 && detectedAmount < 300000) {
      // Insufficient deposit detected
      recheckSection.className = 'recheck-section insufficient';
      recheckSection.innerHTML = `
        <p class="insufficient-title">Deposit received: ${detectedDash} DASH</p>
        <p class="insufficient-msg">Minimum required: 0.003 DASH. Send more to continue.</p>
        <button id="recheck-deposit-btn" class="secondary-btn">Check Again</button>
      `;
    } else {
      // No deposit detected
      recheckSection.innerHTML = `
        <p>No transaction detected yet.</p>
        <button id="recheck-deposit-btn" class="secondary-btn">Check Again</button>
      `;
    }

    div.appendChild(recheckSection);
  }

  // Mode-specific note at bottom
  if (state.mode === 'topup') {
    // One-time key warning for top-up
    const keyWarning = document.createElement('div');
    keyWarning.className = 'key-warning';
    keyWarning.innerHTML = `
      <p><strong>Important:</strong> This is a one-time address.</p>
      <p>A recovery key was downloaded automatically. Keep it safe to recover funds if something goes wrong.</p>
    `;
    div.appendChild(keyWarning);
  } else {
    // Key backup confirmation for create mode
    const backupNote = document.createElement('p');
    backupNote.className = 'backup-note';
    backupNote.innerHTML = '<span class="backup-check">✓</span> Keys saved. Keep the download safe if you close this page.';
    div.appendChild(backupNote);
  }

  return div;
}

function renderProcessingStep(state: BridgeState): HTMLElement {
  const div = document.createElement('div');
  div.className = 'processing-step';
  const isTopUp = state.mode === 'topup';

  // Headline
  const headline = document.createElement('h2');
  headline.className = 'processing-headline';
  headline.textContent = isTopUp ? 'Processing top-up' : 'Creating your identity';
  div.appendChild(headline);

  // Subtitle
  const subtitle = document.createElement('p');
  subtitle.className = 'processing-subtitle';
  subtitle.textContent = isTopUp
    ? 'Adding credits to your identity on Dash Platform.'
    : 'Registering your identity on Dash Platform. This may take a moment.';
  div.appendChild(subtitle);

  const spinner = document.createElement('div');
  spinner.className = 'spinner large';
  div.appendChild(spinner);

  // Status text
  const status = document.createElement('p');
  status.className = 'processing-status';
  status.textContent = 'Waiting for confirmation...';
  div.appendChild(status);

  // Transaction details card
  const detailsCard = document.createElement('div');
  detailsCard.className = 'processing-details';

  if (state.txid) {
    const txRow = document.createElement('div');
    txRow.className = 'detail-row';
    txRow.innerHTML = `
      <label>Transaction ID</label>
      <code class="txid">${state.txid}</code>
    `;
    detailsCard.appendChild(txRow);
  }

  if (state.depositAmount) {
    const amountDash = Number(state.depositAmount) / 100_000_000;
    const amountRow = document.createElement('div');
    amountRow.className = 'detail-row';
    amountRow.innerHTML = `
      <label>Amount</label>
      <span class="amount">${amountDash.toFixed(8)} DASH</span>
    `;
    detailsCard.appendChild(amountRow);
  }

  if (detailsCard.children.length > 0) {
    div.appendChild(detailsCard);
  }

  return div;
}

function renderCompleteStep(state: BridgeState): HTMLElement {
  const div = document.createElement('div');
  const isTopUp = state.mode === 'topup';
  div.className = `complete-step ${isTopUp ? 'topup-complete' : ''}`;

  // Lead with mode-specific headline
  const headline = document.createElement('h2');
  headline.className = 'complete-headline';
  headline.textContent = isTopUp ? 'Top-up complete!' : 'Save your keys';
  div.appendChild(headline);

  const subtitle = document.createElement('p');
  subtitle.className = 'complete-subtitle';
  subtitle.textContent = isTopUp
    ? 'Credits have been added to your identity.'
    : 'Your identity was created. Download your keys to access it.';
  div.appendChild(subtitle);

  if (!isTopUp) {
    // Primary action - key backup (only for create mode)
    const backupSection = document.createElement('div');
    backupSection.className = 'backup-section';
    backupSection.innerHTML = `
      <button id="download-keys-btn" class="primary-btn">Download Key Backup</button>
      <p class="backup-warning">Keys cannot be recovered if lost.</p>
    `;
    div.appendChild(backupSection);
  }

  // Identity ID info
  const identityInfo = document.createElement('div');
  identityInfo.className = 'identity-info';
  identityInfo.innerHTML = `
    <label>${isTopUp ? 'Identity ID' : 'Your Identity ID'}</label>
    <code class="identity-id">${state.identityId || state.targetIdentityId || 'Unknown'}</code>
  `;
  div.appendChild(identityInfo);

  // Transaction ID (for top-up mode)
  if (isTopUp && state.txid) {
    const txInfo = document.createElement('div');
    txInfo.className = 'tx-info';
    txInfo.innerHTML = `
      <label>Transaction ID</label>
      <code class="txid">${state.txid}</code>
    `;
    div.appendChild(txInfo);
  }

  // Start over button (for both modes)
  const startOverBtn = document.createElement('button');
  startOverBtn.id = 'retry-btn';
  startOverBtn.className = 'secondary-btn';
  startOverBtn.textContent = 'Start Over';
  div.appendChild(startOverBtn);

  return div;
}

function renderErrorStep(state: BridgeState): HTMLElement {
  const div = document.createElement('div');
  div.className = 'error-step';

  div.innerHTML = `
    <div class="error-icon">❌</div>
    <h2>Error</h2>
    <p class="error-message">${state.error?.message || 'An unknown error occurred'}</p>
    <button id="retry-btn" class="secondary-btn">Try Again</button>
  `;

  return div;
}

/**
 * Create key backup JSON
 */
export function createKeyBackup(state: BridgeState): string {
  const network = getNetwork(state.network);
  const isTopUp = state.mode === 'topup';

  const backup: Record<string, unknown> = {
    network: state.network,
    created: new Date().toISOString(),
    mode: state.mode,
    depositAddress: state.depositAddress,
    txid: state.txid,
  };

  // For create mode: include mnemonic and identity keys
  if (!isTopUp) {
    backup.mnemonic = state.mnemonic;
    backup.identityId = state.identityId;
    backup.identityKeys = state.identityKeys.map((key) => ({
      id: key.id,
      name: key.name,
      keyType: key.keyType,
      purpose: key.purpose,
      securityLevel: key.securityLevel,
      privateKeyWif: key.privateKeyWif,
      privateKeyHex: key.privateKeyHex,
      publicKeyHex: key.publicKeyHex,
      derivationPath: key.derivationPath,
    }));
    backup.assetLockKey = state.assetLockKeyPair
      ? {
          wif: privateKeyToWif(state.assetLockKeyPair.privateKey, network),
          publicKeyHex: bytesToHex(state.assetLockKeyPair.publicKey),
          derivationPath: getAssetLockDerivationPath(state.network),
        }
      : null;
  } else {
    // For top-up mode: include target identity and one-time key
    backup.targetIdentityId = state.targetIdentityId;
    backup.assetLockKey = state.assetLockKeyPair
      ? {
          wif: privateKeyToWif(state.assetLockKeyPair.privateKey, network),
          publicKeyHex: bytesToHex(state.assetLockKeyPair.publicKey),
          note: 'One-time key for top-up. Use this WIF to recover funds if top-up fails.',
        }
      : null;
  }

  return JSON.stringify(backup, null, 2);
}

/**
 * Download key backup as a file
 */
export function downloadKeyBackup(state: BridgeState): void {
  const backup = createKeyBackup(state);
  const blob = new Blob([backup], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const isTopUp = state.mode === 'topup';

  // Generate descriptive filename based on mode and available data
  let filename: string;
  if (isTopUp && state.targetIdentityId) {
    // Top-up mode: include target identity ID for reference
    const idShort = state.targetIdentityId.slice(0, 8);
    filename = `dash-topup-${idShort}-recovery.json`;
  } else if (state.identityId) {
    filename = `dash-identity-${state.identityId}.json`;
  } else if (state.depositAddress) {
    // Use first/last chars of address for recognizability
    const addr = state.depositAddress;
    const prefix = isTopUp ? 'dash-topup' : 'dash-keys';
    filename = `${prefix}-${addr.slice(0, 6)}-${addr.slice(-4)}-pending.json`;
  } else {
    filename = `dash-keys-${Date.now()}.json`;
  }

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
