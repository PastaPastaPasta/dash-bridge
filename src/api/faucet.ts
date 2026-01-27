/**
 * Faucet API client with CAP (proof-of-work) support
 * Implements CAP solving using browser-native Web Crypto API
 */

export interface FaucetStatus {
  status: string;
  /** If present, CAP proof-of-work is required */
  capEndpoint?: string;
}

export interface FaucetResponse {
  txid: string;
  amount: number;
  address: string;
}

export interface FaucetError {
  error: string;
  retryAfter?: number;
}

/** CAP challenge from the server */
interface CapChallenge {
  challenge: string;
  difficulty: number;
  algorithm?: string;
  expiresAt?: number;
}

/** CAP solution to submit */
interface CapSolution {
  challenge: string;
  nonce: number;
}

/**
 * Fetch faucet status to check if CAP is required
 */
export async function getFaucetStatus(baseUrl: string): Promise<FaucetStatus> {
  const response = await fetch(`${baseUrl}/api/status`);

  if (!response.ok) {
    throw new Error(`Failed to fetch faucet status: ${response.status}`);
  }

  return response.json();
}

/**
 * Convert ArrayBuffer to hex string
 */
function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Check if a hash meets the difficulty requirement (has enough leading zeros)
 */
function meetsTarget(hashHex: string, difficulty: number): boolean {
  // Difficulty is the number of leading zero bits required
  const leadingZeroBytes = Math.floor(difficulty / 8);
  const remainingBits = difficulty % 8;

  // Check full zero bytes
  for (let i = 0; i < leadingZeroBytes; i++) {
    if (hashHex.substring(i * 2, i * 2 + 2) !== '00') {
      return false;
    }
  }

  // Check remaining bits
  if (remainingBits > 0) {
    const nextByte = parseInt(hashHex.substring(leadingZeroBytes * 2, leadingZeroBytes * 2 + 2), 16);
    const mask = 0xff << (8 - remainingBits);
    if ((nextByte & mask) !== 0) {
      return false;
    }
  }

  return true;
}

/**
 * Solve CAP proof-of-work challenge using Web Crypto API
 */
async function solveChallenge(challenge: CapChallenge): Promise<CapSolution> {
  const encoder = new TextEncoder();
  let nonce = 0;
  const maxIterations = 10_000_000; // Safety limit

  while (nonce < maxIterations) {
    const data = encoder.encode(`${challenge.challenge}:${nonce}`);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashHex = bufferToHex(hashBuffer);

    if (meetsTarget(hashHex, challenge.difficulty)) {
      return { challenge: challenge.challenge, nonce };
    }

    nonce++;

    // Yield to UI every 10000 iterations to prevent blocking
    if (nonce % 10000 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  throw new Error('Failed to solve proof of work within iteration limit');
}

/**
 * Solve CAP proof-of-work challenge
 * Fetches challenge from the CAP endpoint and solves it
 */
export async function solveCap(capEndpoint: string): Promise<string> {
  // Step 1: Get challenge from server
  const challengeResponse = await fetch(`${capEndpoint}/challenge`);
  if (!challengeResponse.ok) {
    throw new Error(`Failed to get CAP challenge: ${challengeResponse.status}`);
  }
  const challenge: CapChallenge = await challengeResponse.json();

  // Step 2: Solve the challenge
  const solution = await solveChallenge(challenge);

  // Step 3: Submit solution and get token
  const verifyResponse = await fetch(`${capEndpoint}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(solution),
  });

  if (!verifyResponse.ok) {
    throw new Error(`CAP verification failed: ${verifyResponse.status}`);
  }

  const result = await verifyResponse.json();
  return result.token;
}

/**
 * Request testnet funds from the faucet
 */
export async function requestTestnetFunds(
  baseUrl: string,
  address: string,
  amount: number = 1.0,
  capToken?: string
): Promise<FaucetResponse> {
  const body: Record<string, unknown> = {
    address,
    amount,
  };

  if (capToken) {
    body.capToken = capToken;
  }

  const response = await fetch(`${baseUrl}/api/core-faucet`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({})) as Partial<FaucetError>;

    if (response.status === 429) {
      const retryAfter = errorData.retryAfter;
      if (retryAfter) {
        const minutes = Math.ceil(retryAfter / 60);
        throw new Error(`Rate limit exceeded. Try again in ${minutes} minute${minutes !== 1 ? 's' : ''}.`);
      }
      throw new Error('Rate limit exceeded. Please try again later.');
    }

    throw new Error(errorData.error || `Faucet request failed: ${response.status}`);
  }

  return response.json();
}
