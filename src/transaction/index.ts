export {
  serCompactSize,
  serString,
  serUint32,
  serInt32,
  serInt64,
  serByte,
} from './serialize.js';

export {
  type COutPoint,
  type CTxIn,
  type CTxOut,
  type CAssetLockPayload,
  serializeOutPoint,
  serializeTxIn,
  serializeTxOut,
  serializeAssetLockPayload,
  createP2PKHScript,
  createOpReturnScript,
} from './structures.js';

export {
  type AssetLockTransaction,
  serializeTransaction,
  calculateTxId,
  calculateTxIdFromBytes,
  createAssetLockTransaction,
  cloneTransaction,
} from './builder.js';

export {
  signatureHash,
  getScriptCodeFromUtxo,
  SIGHASH_ALL,
} from './sighash.js';
