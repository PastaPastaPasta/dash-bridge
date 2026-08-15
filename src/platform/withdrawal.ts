import { withRetry, type RetryOptions } from '../utils/retry.js';
import { extractErrorMessage } from '../utils/errors.js';
import { loadSdkModule } from './sdkModule.js';
import {
  PLATFORM_PUT_SETTINGS,
  PlatformOperationTimeoutError,
  fetchIdentityWithSdk,
  withConnectedPlatformSdk,
  withPlatformOperationTimeout,
} from './client.js';

/**
 * The withdrawals system data contract. Not bundled into the wasm SDK's
 * default known contracts, so the first documents query fetches it (with
 * proof) from the network.
 */
export const WITHDRAWALS_CONTRACT_ID = '4fJLR2GYTPFdomuTVvNy3VRrvWgvkKPzqehEBpNf2nk6';

export { WithdrawalStatus } from './withdrawal-status.js';

/**
 * Timeout for the full submit-and-wait-for-inclusion round trip. Longer than
 * the default 45s guard because a timeout here is ambiguous — the transition
 * may already be broadcast — and a false failure invites a double spend.
 */
const WITHDRAWAL_OPERATION_TIMEOUT_MS = 120_000;

export interface WithdrawResult {
  success: boolean;
  /** Identity balance (credits) after the withdrawal, when successful. */
  remainingBalance?: bigint;
  error?: string;
  /**
   * True when the operation timed out waiting for confirmation. The
   * transition may still have been broadcast and included — callers must
   * treat this as "unknown", not as a failure.
   */
  timedOut?: boolean;
}

/**
 * Withdraw credits from an identity to a Dash Core address.
 *
 * The signing key must be a TRANSFER-purpose key: with a destination address
 * present, OWNER-key-signed withdrawals are rejected by consensus. The SDK
 * builds the transition (pooling Never, nonce fetch), signs, broadcasts, and
 * waits for inclusion, returning the remaining identity balance.
 */
export async function withdrawCredits(
  identityId: string,
  privateKeyWif: string,
  amountCredits: bigint,
  toAddress: string,
  network: string,
  retryOptions?: RetryOptions
): Promise<WithdrawResult> {
  return withConnectedPlatformSdk(network, async (sdk) => {
    try {
      console.log('Withdrawing', amountCredits.toString(), 'credits from', identityId, 'to', toAddress);

      const identity = await fetchIdentityWithSdk(sdk, identityId, retryOptions);
      if (!identity) {
        throw new Error(`Identity not found: ${identityId}`);
      }

      const { IdentitySigner } = await loadSdkModule();
      const signer = new IdentitySigner();
      signer.addKeyFromWif(privateKeyWif);

      // Deliberately single-submit: no retry wrapper and no SDK-level retries.
      // A retry after an ambiguous network error would rebuild the transition
      // with a fresh nonce and could withdraw a second time if the first
      // attempt actually landed. Ambiguous outcomes surface as timedOut and
      // are resolved by the caller via status tracking instead.
      const remainingBalance = await withPlatformOperationTimeout(
        sdk.identities.creditWithdrawal({
          identity,
          amount: amountCredits,
          toAddress,
          coreFeePerByte: 1,
          signer,
          settings: { ...PLATFORM_PUT_SETTINGS, retries: 0 },
        }),
        'waiting for credit withdrawal confirmation',
        WITHDRAWAL_OPERATION_TIMEOUT_MS
      );

      console.log('Withdrawal accepted, remaining balance:', remainingBalance.toString());

      return { success: true, remainingBalance };
    } catch (error) {
      console.error('Credit withdrawal error:', error);
      return {
        success: false,
        error: extractErrorMessage(error),
        timedOut: error instanceof PlatformOperationTimeoutError,
      };
    }
  }, retryOptions);
}

export interface WithdrawalStatusRecord {
  status: number;
  amountCredits: bigint;
  createdAt: number;
  updatedAt: number;
}

/**
 * Fetch the most recent withdrawal document for an identity created at or
 * after `sinceMs`. Returns null while no matching document exists yet
 * (the quorum creates it when the withdrawal transition is processed).
 */
export async function fetchLatestWithdrawalStatus(
  identityId: string,
  network: string,
  sinceMs: number,
  retryOptions?: RetryOptions
): Promise<WithdrawalStatusRecord | null> {
  return withConnectedPlatformSdk(network, async (sdk) => {
    const documents = await withPlatformOperationTimeout(
      withRetry(
        () => sdk.documents.query({
          dataContractId: WITHDRAWALS_CONTRACT_ID,
          documentTypeName: 'withdrawal',
          where: [['$ownerId', '==', identityId]],
          orderBy: [['$updatedAt', 'desc']],
          limit: 10,
        }),
        retryOptions
      ),
      'fetching withdrawal status'
    );

    let latest: WithdrawalStatusRecord | null = null;
    for (const doc of documents.values()) {
      if (!doc) continue;
      const createdAt = doc.createdAt !== undefined ? Number(doc.createdAt) : 0;
      const updatedAt = doc.updatedAt !== undefined ? Number(doc.updatedAt) : createdAt;
      if (createdAt < sinceMs) continue;
      const props = doc.properties as { status?: unknown; amount?: unknown };
      const status = typeof props.status === 'number' ? props.status : Number(props.status ?? NaN);
      if (!Number.isFinite(status)) continue;
      if (!latest || updatedAt > latest.updatedAt) {
        latest = {
          status,
          amountCredits: BigInt(String(props.amount ?? 0)),
          createdAt,
          updatedAt,
        };
      }
    }
    return latest;
  }, retryOptions);
}
