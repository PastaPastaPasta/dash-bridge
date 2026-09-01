import type { EvoSDK } from '@dashevo/evo-sdk';
import { withRetry, type RetryOptions } from '../utils/retry.js';
import { bytesToHex } from '../utils/hex.js';
import {
  PLATFORM_PUT_SETTINGS,
  fetchIdentity,
  fetchIdentityWithSdk,
  withConnectedPlatformSdk,
  withPlatformOperationTimeout,
} from './client.js';
import { extractErrorMessage } from '../utils/errors.js';
import { loadSdkModule } from './sdkModule.js';
import type { DerivedCandidateKey } from './username-transfer-utils.js';
import type { UsernameTransferOutcome } from '../types.js';

/**
 * DPNS is a system data contract with the same ID on every network.
 * Source: packages/dpns-contract/lib/systemIds.js in dashpay/platform.
 */
const DPNS_CONTRACT_ID = 'GWRSAVFMjXx8HpQFaNJMqBV7MBgMK4br5UESsB4S31Ec';
const DPNS_DOCUMENT_TYPE = 'domain';

/** Usernames query defaults to a limit of 10; ask for more than anyone owns. */
const USERNAME_LIST_LIMIT = 100;

export interface DiscoveredIdentity {
  identityId: string;
  candidate: DerivedCandidateKey;
}

/**
 * Look up the identity that a derived key belongs to.
 *
 * Tries the unique public-key-hash index first, then the non-unique one, since
 * identity keys may be registered either way. Both lookups throw on a miss as
 * well as on a transport failure, so an absent `error` records that at least
 * one query actually completed — the caller needs that to tell "this seed owns
 * nothing" apart from "the network is unreachable".
 */
async function findIdentityIdByPublicKeyHash(
  sdk: EvoSDK,
  publicKeyHash: Uint8Array
): Promise<{ identityId?: string; error?: unknown }> {
  const hashHex = bytesToHex(publicKeyHash);
  let lastError: unknown;
  let answered = false;

  try {
    const identity = await sdk.identities.byPublicKeyHash(hashHex);
    answered = true;
    if (identity) return { identityId: identity.id.toString() };
  } catch (error) {
    lastError = error;
  }

  try {
    const identities = await sdk.identities.byNonUniquePublicKeyHash(hashHex);
    answered = true;
    if (identities.length > 0) return { identityId: identities[0].id.toString() };
  } catch (error) {
    lastError = error;
  }

  // An absent `error` means at least one query came back — i.e. a real
  // "no such identity", not a network problem.
  return answered ? {} : { error: lastError };
}

/**
 * Walk derived candidates in order and return the first one that resolves to a
 * registered identity. Candidates are pre-ordered cheapest-first, so this
 * usually resolves on the first or second lookup.
 *
 * Throws if no lookup ever completed, so an unreachable network is not reported
 * to the user as an unrecognised seed phrase.
 */
export async function discoverIdentityFromCandidates(
  candidates: DerivedCandidateKey[],
  network: string,
  onProgress?: (checked: number, total: number) => void,
  retryOptions?: RetryOptions
): Promise<DiscoveredIdentity | undefined> {
  return withConnectedPlatformSdk(
    network,
    async (sdk) => {
      let anyAnswered = false;
      let lastError: unknown;

      for (let i = 0; i < candidates.length; i++) {
        const candidate = candidates[i];
        onProgress?.(i + 1, candidates.length);

        const result = await findIdentityIdByPublicKeyHash(sdk, candidate.publicKeyHash);
        if (result.identityId) {
          return { identityId: result.identityId, candidate };
        }
        if (result.error === undefined) {
          anyAnswered = true;
        } else {
          lastError = result.error;
        }
      }

      if (!anyAnswered && lastError !== undefined) {
        throw lastError;
      }
      return undefined;
    },
    retryOptions
  );
}

/**
 * List the usernames an identity owns.
 *
 * Note this queries by `records.identity`, not `$ownerId` — the two are kept in
 * sync by Platform on transfer, but the caller still re-checks `ownerId` on the
 * document before signing rather than trusting this listing.
 */
export async function listOwnedUsernames(
  identityId: string,
  network: string,
  retryOptions?: RetryOptions
): Promise<string[]> {
  return withConnectedPlatformSdk(
    network,
    (sdk) =>
      withRetry(
        () => sdk.dpns.usernames({ identityId, limit: USERNAME_LIST_LIMIT }),
        retryOptions
      ),
    retryOptions
  );
}

/**
 * Read the protocol version the network is currently running.
 */
export async function getProtocolVersion(
  network: string,
  retryOptions?: RetryOptions
): Promise<number> {
  return withConnectedPlatformSdk(
    network,
    async (sdk) => {
      const epoch = await withRetry(() => sdk.epoch.current(), retryOptions);
      return epoch.protocolVersion;
    },
    retryOptions
  );
}

/**
 * Check that a recipient identity actually exists.
 *
 * This matters more than it looks: Platform does *not* validate that a document
 * transfer's recipient exists, so transferring to a mistyped identity ID would
 * permanently orphan the username with no way to recover it.
 */
export async function identityExists(
  identityId: string,
  network: string,
  retryOptions?: RetryOptions
): Promise<boolean> {
  const identity = await fetchIdentity(identityId, network, retryOptions);
  return identity !== undefined && identity !== null;
}

/**
 * Normalize an identifier-shaped document property to Base58.
 *
 * `records.identity` comes back as either an SDK `Identifier` or the raw 32
 * bytes depending on how the document was decoded, and `String(bytes)` would
 * silently produce a comma-separated list that never compares equal.
 */
async function toBase58Id(value: unknown): Promise<string | undefined> {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;

  if (typeof (value as { toBase58?: unknown }).toBase58 === 'function') {
    return (value as { toBase58(): string }).toBase58();
  }

  if (value instanceof Uint8Array) {
    const { Identifier } = await loadSdkModule();
    try {
      return Identifier.fromBytes(value).toBase58();
    } catch {
      return undefined;
    }
  }

  return undefined;
}

/**
 * Read a domain document's current owner and identity record.
 */
async function readDomainOwnership(
  sdk: EvoSDK,
  documentId: string
): Promise<{ ownerId: string; recordIdentity?: string } | undefined> {
  const document = await sdk.documents.get(DPNS_CONTRACT_ID, DPNS_DOCUMENT_TYPE, documentId);
  if (!document) return undefined;

  const records = document.properties?.records as { identity?: unknown } | undefined;

  return {
    ownerId: document.ownerId.toString(),
    recordIdentity: await toBase58Id(records?.identity),
  };
}

export interface TransferUsernameParams {
  username: string;
  identityId: string;
  publicKeyId: number;
  privateKeyWif: string;
  recipientId: string;
  network: string;
}

/**
 * Transfer a DPNS username to another identity.
 *
 * There is no `dpns.transfer` in the SDK — a username transfer is a generic
 * document transfer of the DPNS `domain` document that backs the name.
 */
export async function transferUsername(
  params: TransferUsernameParams,
  retryOptions?: RetryOptions
): Promise<UsernameTransferOutcome> {
  const { username, identityId, publicKeyId, privateKeyWif, recipientId, network } = params;

  if (identityId === recipientId) {
    return { success: false, error: 'Cannot transfer a username to the identity that already owns it' };
  }

  return withConnectedPlatformSdk(
    network,
    async (sdk) => {
      const info = await withRetry(() => sdk.dpns.getUsernameByName(username), retryOptions);
      if (!info) {
        return { success: false, error: `Username "${username}" was not found on ${network}` };
      }

      const documentId = info.documentId.toString();
      if (info.identityId.toString() !== identityId) {
        return {
          success: false,
          error: `"${username}" is owned by ${info.identityId.toString()}, not ${identityId}`,
        };
      }

      const document = await withRetry(
        () => sdk.documents.get(DPNS_CONTRACT_ID, DPNS_DOCUMENT_TYPE, documentId),
        retryOptions
      );
      if (!document) {
        return { success: false, error: `Domain document ${documentId} could not be fetched` };
      }

      // Re-check ownership on the document itself. `getUsernameByName` reports
      // the owner, but this is the object we are about to sign over.
      if (document.ownerId.toString() !== identityId) {
        return {
          success: false,
          error: `Domain document is owned by ${document.ownerId.toString()}, not ${identityId}`,
        };
      }

      // Platform requires the transition's revision to be exactly
      // stored_revision + 1, and the SDK passes the document's revision through
      // untouched, so the bump is ours to do. DPNS `domain` is transferable and
      // therefore always carries a revision; guessing one would guarantee a
      // rejected transition, so bail out instead.
      if (document.revision === undefined || document.revision === null) {
        return { success: false, error: `Domain document ${documentId} has no revision` };
      }
      document.revision = document.revision + 1n;

      const identity = await fetchIdentityWithSdk(sdk, identityId, retryOptions);
      if (!identity) {
        return { success: false, error: `Identity ${identityId} not found` };
      }

      const identityKey = identity.getPublicKeyById(publicKeyId);
      if (!identityKey) {
        return { success: false, error: `Identity key ${publicKeyId} not found` };
      }

      const { IdentitySigner, Identifier } = await loadSdkModule();
      const signer = new IdentitySigner();
      signer.addKeyFromWif(privateKeyWif);

      let broadcastError: unknown;
      try {
        // Deliberately not wrapped in withRetry: a retry after a broadcast that
        // actually landed fails the revision check and would report a false
        // failure. The read-back below settles what really happened instead.
        await withPlatformOperationTimeout(
          sdk.documents.transfer({
            document,
            recipientId: Identifier.fromBase58(recipientId),
            identityKey,
            signer,
            settings: PLATFORM_PUT_SETTINGS,
          }),
          'transferring username'
        );
      } catch (error) {
        broadcastError = error;
      }

      // This read is what turns a thrown timeout into a truthful answer, so it
      // gets the same retry treatment as the other reads here.
      const ownership = await withRetry(
        () => readDomainOwnership(sdk, documentId),
        retryOptions
      ).catch(() => undefined);

      if (ownership?.ownerId === recipientId) {
        // Landed — whether or not the wait phase threw.
        return {
          success: true,
          verifiedOwner: true,
          recordsUpdated: ownership.recordIdentity === recipientId,
        };
      }

      if (broadcastError !== undefined) {
        return {
          success: false,
          error: extractErrorMessage(broadcastError),
          // If we could not read the document back we genuinely do not know
          // whether the transfer landed, and the UI must not present a blind
          // retry as safe.
          unconfirmed: ownership === undefined,
        };
      }

      // The SDK reported success but the document does not show the new owner
      // yet — most likely read-your-writes lag rather than a failure.
      return { success: true, verifiedOwner: false };
    },
    retryOptions
  );
}
