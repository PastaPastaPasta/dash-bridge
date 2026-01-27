/**
 * Faucet API client with CAP (proof-of-work) support
 */

// Declare the global Cap class from @cap.js/widget
declare const Cap: {
  new (options: { apiEndpoint: string }): {
    solve(): Promise<{ success: boolean; token: string }>;
  };
};

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
 * Solve CAP proof-of-work challenge
 * Uses the global Cap class from @cap.js/widget loaded via CDN
 */
export async function solveCap(capEndpoint: string): Promise<string> {
  if (typeof Cap === 'undefined') {
    throw new Error('CAP widget not loaded. Please refresh the page.');
  }

  const cap = new Cap({ apiEndpoint: capEndpoint });
  const result = await cap.solve();

  if (!result.success) {
    throw new Error('CAP challenge failed');
  }

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

  console.log('Faucet request body:', body);
  const response = await fetch(`${baseUrl}/api/core-faucet`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    console.error('Faucet error response:', errorData);

    if (response.status === 429) {
      const retryAfter = (errorData as FaucetError).retryAfter;
      if (retryAfter) {
        const minutes = Math.ceil(retryAfter / 60);
        throw new Error(`Rate limit exceeded. Try again in ${minutes} minute${minutes !== 1 ? 's' : ''}.`);
      }
      throw new Error('Rate limit exceeded. Please try again later.');
    }

    // Handle various error response formats
    const errorMessage = errorData.error || errorData.message || errorData.detail || JSON.stringify(errorData);
    throw new Error(errorMessage || `Faucet request failed: ${response.status}`);
  }

  return response.json();
}
