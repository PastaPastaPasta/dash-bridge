export {
  KeyType as KeyTypeNumeric,
  KeyPurpose as KeyPurposeNumeric,
  SecurityLevel as SecurityLevelNumeric,
  KeyTypeString,
  KeyPurposeString,
  SecurityLevelString,
  createPublicKeyInfo,
  publicKeyToBase64,
  registerIdentity,
  topUpIdentity,
  updateIdentity,
  fundPlatformAddress,
} from './identity.js';

export type { AddKeyConfig } from './identity.js';
