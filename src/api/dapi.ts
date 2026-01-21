/**
 * DAPI client for Dash Platform operations
 * Uses DAPI gRPC for all network communication - no third-party dependencies
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// Import CommonJS modules - types are handled manually below
import DAPIClientModule from '@dashevo/dapi-client';
import dashcoreLib from '@dashevo/dashcore-lib';
import type { UTXO } from '../types.js';

// Type definitions for external modules
interface BloomFilterStatic {
  create(elements: number, falsePositiveRate: number, nTweak: number, nFlags: number): BloomFilterInstance;
  BLOOM_UPDATE_ALL: number;
  BLOOM_UPDATE_NONE: number;
}

interface BloomFilterInstance {
  vData: number[];
  nHashFuncs: number;
  nTweak: number;
  nFlags: number;
  insert(data: Uint8Array | Buffer): void;
}

interface InstantLockStatic {
  fromBuffer(buffer: Buffer): { txid: string };
}

// Get the actual constructor/class from the module
const DAPIClientClass = (DAPIClientModule as any).default || DAPIClientModule;
const BloomFilter = (dashcoreLib as any).BloomFilter as BloomFilterStatic;
const InstantLock = (dashcoreLib as any).InstantLock as InstantLockStatic;

export interface DAPIConfig {
  network: 'testnet' | 'mainnet';
}

/**
 * Client for Dash network operations using DAPI gRPC subscriptions
 */
export class BridgeDAPIClient {
  readonly network: 'testnet' | 'mainnet';
  private dapiClient: any = null;

  constructor(config: DAPIConfig) {
    this.network = config.network;
  }

  /**
   * Get or create the DAPI client instance
   */
  private getClient(): any {
    if (!this.dapiClient) {
      this.dapiClient = new DAPIClientClass({
        network: this.network,
        timeout: 30000,
        retries: 3,
      });
    }
    return this.dapiClient;
  }

  /**
   * Create a bloom filter for matching transactions
   * @param pubKeyHash - The public key hash (20 bytes)
   * @param outpoint - Optional outpoint being spent (txid + vout)
   * @returns Bloom filter object with vData, nHashFuncs, nTweak, nFlags
   */
  private createBloomFilter(
    pubKeyHash: Uint8Array,
    outpoint?: { txid: string; vout: number }
  ): {
    vData: Uint8Array;
    nHashFuncs: number;
    nTweak: number;
    nFlags: number;
  } {
    const elementCount = outpoint ? 3 : 2;
    const nTweak = Math.floor(Math.random() * 0xffffffff);
    // 1% false positive rate provides good balance of matching and efficiency
    const filter = BloomFilter.create(elementCount, 0.01, nTweak, BloomFilter.BLOOM_UPDATE_ALL);

    // Insert the pubkey hash - matches P2PKH scripts containing this hash
    filter.insert(Buffer.from(pubKeyHash));

    // Insert the full P2PKH scriptPubKey
    const scriptPubKey = Buffer.concat([
      Buffer.from([0x76, 0xa9, 0x14]), // OP_DUP OP_HASH160 PUSH20
      Buffer.from(pubKeyHash),
      Buffer.from([0x88, 0xac]) // OP_EQUALVERIFY OP_CHECKSIG
    ]);
    filter.insert(scriptPubKey);

    // Insert the outpoint being spent (txid reversed + vout as 4-byte LE)
    if (outpoint) {
      const txidBytes = Buffer.from(outpoint.txid, 'hex').reverse();
      const voutBytes = Buffer.alloc(4);
      voutBytes.writeUInt32LE(outpoint.vout, 0);
      filter.insert(Buffer.concat([txidBytes, voutBytes]));
    }

    return {
      vData: new Uint8Array(filter.vData),
      nHashFuncs: filter.nHashFuncs,
      nTweak: filter.nTweak,
      nFlags: filter.nFlags,
    };
  }

  /**
   * Parse an InstantLock message and extract the txid
   */
  private parseInstantLockTxid(islockBytes: Uint8Array): string | null {
    try {
      const islock = InstantLock.fromBuffer(Buffer.from(islockBytes));
      return islock.txid;
    } catch {
      return null;
    }
  }

  /**
   * Get the current best block height from DAPI
   */
  private async getBestBlockHeight(): Promise<number> {
    const client = this.getClient();
    return await client.core.getBestBlockHeight();
  }

  /**
   * Wait for InstantSend lock using DAPI subscription
   *
   * IMPORTANT: To avoid race conditions, pass an onReady callback that broadcasts the
   * transaction. The callback is invoked after the subscription is established but before
   * we start waiting for messages, ensuring we don't miss the InstantSend lock.
   *
   * @param txid - Transaction ID to wait for (hex string)
   * @param pubKeyHash - Public key hash (20 bytes) used in asset lock credit output
   * @param outpoint - The UTXO outpoint being spent
   * @param timeoutMs - Timeout in milliseconds (default: 60000)
   * @param onProgress - Optional callback for progress updates
   * @param onReady - Optional callback invoked after subscription is ready (use to broadcast tx)
   * @returns InstantSend lock bytes
   */
  async waitForInstantSendLock(
    txid: string,
    pubKeyHash: Uint8Array,
    outpoint: { txid: string; vout: number },
    timeoutMs: number = 60000,
    onProgress?: (message: string) => void,
    onReady?: () => Promise<void>
  ): Promise<Uint8Array> {
    const client = this.getClient();

    onProgress?.('Creating bloom filter for transaction...');
    const bloomFilter = this.createBloomFilter(pubKeyHash, outpoint);

    onProgress?.('Getting current block height...');
    const currentHeight = await this.getBestBlockHeight();
    // Start from a few blocks back to ensure we don't miss anything
    const fromBlockHeight = Math.max(1, currentHeight - 10);

    onProgress?.(`Subscribing to transactions from block ${fromBlockHeight}...`);

    return new Promise<Uint8Array>((resolve, reject) => {
      let stream: ReturnType<typeof client.core.subscribeToTransactionsWithProofs> | null = null;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let resolved = false;

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (stream) {
          try {
            stream.cancel();
          } catch {
            // Ignore errors during cleanup
          }
          stream = null;
        }
      };

      timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(new Error(`Timeout waiting for InstantSend lock for ${txid} after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      (async () => {
        try {
          stream = await client.core.subscribeToTransactionsWithProofs(
            bloomFilter,
            { fromBlockHeight, count: 0 }
          );

          onProgress?.('Listening for InstantSend lock messages...');

          // Call onReady callback now that subscription is established
          if (onReady) {
            try {
              await onReady();
            } catch (error) {
              if (!resolved) {
                resolved = true;
                cleanup();
                reject(error);
              }
              return;
            }
          }

          stream.on('data', (response: unknown) => {
            if (resolved) return;

            try {
              const typedResponse = response as any;
              const islockMessages = typedResponse.getInstantSendLockMessages?.();

              if (islockMessages) {
                const messages = islockMessages.getMessagesList_asU8?.() || islockMessages.getMessagesList?.();
                if (messages && messages.length > 0) {
                  for (const msgBytes of messages) {
                    const bytes = msgBytes instanceof Uint8Array ? msgBytes : new Uint8Array(msgBytes);
                    const islockTxid = this.parseInstantLockTxid(bytes);

                    if (islockTxid === txid) {
                      onProgress?.('InstantSend lock received!');
                      resolved = true;
                      cleanup();
                      resolve(bytes);
                      return;
                    }
                  }
                }
              }
            } catch (error) {
              console.warn('Error processing stream data:', error);
            }
          });

          stream.on('error', (error: Error) => {
            console.error('[DAPI] Stream error:', error);
          });

          stream.on('end', () => {
            if (!resolved) {
              resolved = true;
              cleanup();
              reject(new Error(`Stream ended before receiving InstantSend lock for ${txid}`));
            }
          });

        } catch (error) {
          if (!resolved) {
            resolved = true;
            cleanup();
            reject(error);
          }
        }
      })();
    });
  }

  /**
   * Broadcast a raw transaction to the network
   * @param txHex - Transaction in hex format
   * @returns Transaction ID
   */
  async broadcastTransaction(txHex: string): Promise<string> {
    const client = this.getClient();
    const txBuffer = Buffer.from(txHex, 'hex');
    return await client.core.broadcastTransaction(txBuffer);
  }

  /**
   * Wait for a deposit to arrive at an address using DAPI subscription
   * @param pubKeyHash - Public key hash (20 bytes) of the deposit address
   * @param minAmount - Minimum amount in satoshis
   * @param timeoutMs - Timeout in milliseconds
   * @param onProgress - Optional callback for progress updates
   * @returns The UTXO when deposit arrives
   */
  async waitForDeposit(
    pubKeyHash: Uint8Array,
    minAmount: number,
    timeoutMs: number = 120000,
    onProgress?: (message: string) => void
  ): Promise<{ utxo: UTXO | null; totalAmount: number; timedOut: boolean }> {
    // Create a fresh client for each deposit wait to avoid sticky connections to bad nodes
    const client = new DAPIClientClass({
      network: this.network,
      timeout: 10000, // Shorter timeout to fail fast on bad nodes
      retries: 5,
    });

    onProgress?.('Creating bloom filter for deposit address...');

    // Create bloom filter with specific pubKeyHash
    const nTweak = Math.floor(Math.random() * 0xffffffff);
    const pubKeyHashBuf = Buffer.from(pubKeyHash);

    // Build the P2PKH scriptPubKey
    const scriptPubKey = Buffer.concat([
      Buffer.from([0x76, 0xa9, 0x14]), // OP_DUP OP_HASH160 PUSH20
      pubKeyHashBuf,
      Buffer.from([0x88, 0xac]) // OP_EQUALVERIFY OP_CHECKSIG
    ]);

    // Create filter sized for 2 elements with 1% false positive rate
    const filter = BloomFilter.create(2, 0.01, nTweak, BloomFilter.BLOOM_UPDATE_ALL);
    filter.insert(pubKeyHashBuf);
    filter.insert(scriptPubKey);

    const bloomFilter = {
      vData: new Uint8Array(filter.vData),
      nHashFuncs: filter.nHashFuncs,
      nTweak: filter.nTweak,
      nFlags: filter.nFlags,
    };

    console.log('[DAPI:deposit] Bloom filter:', {
      vDataLength: bloomFilter.vData.length,
      nHashFuncs: bloomFilter.nHashFuncs,
      pubKeyHash: pubKeyHashBuf.toString('hex'),
    });

    onProgress?.('Getting current block height...');
    console.log('[DAPI:deposit] Calling getBestBlockHeight...');
    const currentHeight = await client.core.getBestBlockHeight();
    console.log('[DAPI:deposit] Got block height:', currentHeight);
    // Start from earlier blocks to catch already-confirmed transactions
    const fromBlockHeight = Math.max(1, currentHeight - 50);

    console.log('[DAPI:deposit] Starting from:', fromBlockHeight);
    onProgress?.(`Scanning last ${currentHeight - fromBlockHeight} blocks for deposits...`);

    return new Promise((resolve) => {
      let stream: any = null;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let resolved = false;

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (stream) {
          try {
            stream.cancel();
          } catch {
            // Ignore errors during cleanup
          }
          stream = null;
        }
        // Disconnect the temporary client (fire-and-forget)
        client.disconnect().catch(() => {});
      };

      timeoutId = setTimeout(() => {
        if (!resolved) {
          console.log('[DAPI:deposit] Timeout reached, cleaning up...');
          resolved = true;
          cleanup();
          resolve({ utxo: null, totalAmount: 0, timedOut: true });
        }
      }, timeoutMs);

      (async () => {
        try {
          console.log('[DAPI:deposit] About to call subscribeToTransactionsWithProofs...');
          stream = await client.core.subscribeToTransactionsWithProofs(
            bloomFilter,
            { fromBlockHeight, count: 0, sendTransactionHashes: true }
          );

          console.log('[DAPI:deposit] Subscription established');
          onProgress?.('Watching for incoming deposits...');

          stream.on('data', (response: any) => {
            if (resolved) return;

            try {
              const hasRawTx = response.hasRawTransactions?.();
              const hasMerkle = response.hasRawMerkleBlock?.();
              console.log('[DAPI:deposit] Data event - hasRawTx:', hasRawTx, 'hasMerkle:', hasMerkle);

              const rawTx = response.getRawTransactions?.();
              if (rawTx) {
                const txList = rawTx.getTransactionsList_asU8?.() || rawTx.getTransactionsList?.();
                console.log('[DAPI:deposit] Raw tx count:', txList?.length || 0);
                if (txList && txList.length > 0) {
                  for (let i = 0; i < txList.length; i++) {
                    const txBytes = txList[i];
                    const bytes = txBytes instanceof Uint8Array ? txBytes : new Uint8Array(txBytes);
                    console.log('[DAPI:deposit] Processing tx', i, 'of', txList.length, 'size:', bytes.length);
                    const utxo = this.parseTransactionForUtxo(bytes, pubKeyHash);

                    if (utxo && utxo.satoshis >= minAmount) {
                      resolved = true;
                      cleanup();
                      resolve({ utxo, totalAmount: utxo.satoshis, timedOut: false });
                      return;
                    } else if (utxo) {
                      onProgress?.(`Deposit detected: ${utxo.satoshis} satoshis (need ${minAmount})`);
                    }
                  }
                }
              }
            } catch (error) {
              console.warn('[DAPI] Error processing stream data:', error);
            }
          });

          stream.on('error', (error: Error) => {
            console.error('[DAPI] Stream error:', error);
          });

          stream.on('end', () => {
            if (!resolved) {
              resolved = true;
              cleanup();
              resolve({ utxo: null, totalAmount: 0, timedOut: true });
            }
          });

        } catch (error) {
          console.error('[DAPI] Failed to start subscription:', error);
          if (!resolved) {
            resolved = true;
            cleanup();
            resolve({ utxo: null, totalAmount: 0, timedOut: true });
          }
        }
      })();
    });
  }

  /**
   * Parse a raw transaction to find UTXOs paying to a specific pubKeyHash
   */
  private parseTransactionForUtxo(txBytes: Uint8Array, pubKeyHash: Uint8Array): UTXO | null {
    try {
      const Transaction = (dashcoreLib as any).Transaction;
      const tx = new Transaction(Buffer.from(txBytes));
      const txid = tx.hash;
      const lookingFor = Buffer.from(pubKeyHash).toString('hex');

      console.log('[DAPI:parse] Parsing tx:', txid, 'outputs:', tx.outputs.length, 'looking for:', lookingFor);

      for (let vout = 0; vout < tx.outputs.length; vout++) {
        const output = tx.outputs[vout];
        const script = output.script;

        if (script.isPublicKeyHashOut()) {
          const outputPubKeyHash = script.getPublicKeyHash();
          const outputHashHex = outputPubKeyHash?.toString('hex');
          console.log('[DAPI:parse] Output', vout, 'pubKeyHash:', outputHashHex, 'amount:', output.satoshis);

          if (outputPubKeyHash && Buffer.from(pubKeyHash).equals(outputPubKeyHash)) {
            console.log('[DAPI:parse] MATCH FOUND!');
            return {
              txid,
              vout,
              satoshis: output.satoshis,
              scriptPubKey: script.toHex(),
              confirmations: 0,
            };
          }
        }
      }

      return null;
    } catch (error) {
      console.error('[DAPI] Failed to parse transaction:', error);
      return null;
    }
  }

  /**
   * Disconnect and cleanup resources
   */
  async disconnect(): Promise<void> {
    if (this.dapiClient) {
      try {
        await this.dapiClient.disconnect();
      } catch {
        // Ignore errors during disconnect
      }
      this.dapiClient = null;
    }
  }
}

// Export with the original name for compatibility
export { BridgeDAPIClient as DAPIClient };
