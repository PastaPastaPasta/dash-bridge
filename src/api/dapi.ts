/**
 * Client for InstantSend lock retrieval via DAPI subscription
 * Uses subscribeToTransactionsWithProofs instead of third-party RPC endpoints
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// Import CommonJS modules - types are handled manually below
import DAPIClientModule from '@dashevo/dapi-client';
import dashcoreLib from '@dashevo/dashcore-lib';

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
 * Client for InstantSend lock retrieval using DAPI gRPC subscriptions
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
   * Create a bloom filter for a transaction ID
   * @param txid - Transaction ID (hex string, 64 characters)
   * @returns Bloom filter object with vData, nHashFuncs, nTweak, nFlags
   */
  private createBloomFilterForTxid(txid: string): {
    vData: Uint8Array;
    nHashFuncs: number;
    nTweak: number;
    nFlags: number;
  } {
    // Create a bloom filter optimized for a single element with very low false positive rate
    // Parameters: elements=1, falsePositiveRate=0.0001, nTweak=random, nFlags=BLOOM_UPDATE_ALL
    const nTweak = Math.floor(Math.random() * 0xffffffff);
    const filter = BloomFilter.create(1, 0.0001, nTweak, BloomFilter.BLOOM_UPDATE_ALL);

    // Insert the txid bytes (in reversed byte order as used internally in Dash)
    const txidBytes = Buffer.from(txid, 'hex').reverse();
    filter.insert(txidBytes);

    return {
      vData: new Uint8Array(filter.vData),
      nHashFuncs: filter.nHashFuncs,
      nTweak: filter.nTweak,
      nFlags: filter.nFlags,
    };
  }

  /**
   * Parse an InstantLock message and extract the txid
   * @param islockBytes - Raw InstantSend lock message bytes
   * @returns The transaction ID from the islock, or null if parsing fails
   */
  private parseInstantLockTxid(islockBytes: Uint8Array): string | null {
    try {
      const islock = InstantLock.fromBuffer(Buffer.from(islockBytes));
      return islock.txid;
    } catch (error) {
      console.warn('Failed to parse InstantLock message:', error);
      return null;
    }
  }

  /**
   * Get the current best block height from DAPI
   * @returns Current block height
   */
  private async getBestBlockHeight(): Promise<number> {
    const client = this.getClient();
    const height = await client.core.getBestBlockHeight();
    return height;
  }

  /**
   * Wait for InstantSend lock using DAPI subscription
   * Subscribes to transactions with proofs and listens for InstantSend lock messages
   * @param txid - Transaction ID to wait for (hex string)
   * @param timeoutMs - Timeout in milliseconds (default: 60000)
   * @param onProgress - Optional callback for progress updates
   * @returns InstantSend lock bytes
   */
  async waitForInstantSendLock(
    txid: string,
    timeoutMs: number = 60000,
    onProgress?: (message: string) => void
  ): Promise<Uint8Array> {
    const client = this.getClient();

    onProgress?.('Creating bloom filter for transaction...');
    const bloomFilter = this.createBloomFilterForTxid(txid);

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

      // Set up timeout
      timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(new Error(`Timeout waiting for InstantSend lock for ${txid} after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      // Start subscription
      (async () => {
        try {
          stream = await client.core.subscribeToTransactionsWithProofs(
            bloomFilter,
            {
              fromBlockHeight,
              count: 0, // 0 = live streaming mode (continue indefinitely)
            }
          );

          onProgress?.('Listening for InstantSend lock messages...');

          stream.on('data', (response: unknown) => {
            if (resolved) return;

            try {
              // Check for InstantSend lock messages
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const typedResponse = response as any;
              const islockMessages = typedResponse.getInstantSendLockMessages?.();

              if (islockMessages) {
                // getMessagesList_asU8 returns array of Uint8Array
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
            if (!resolved) {
              console.error('Stream error:', error);
              // Don't reject immediately on stream errors, the timeout will handle it
              // Some stream errors are recoverable
            }
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
