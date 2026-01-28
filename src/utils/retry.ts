/**
 * Retry utility with exponential backoff for network resilience
 */

export interface RetryOptions {
  /** Maximum number of attempts (default: 3) */
  maxAttempts?: number;
  /** Base delay in ms between retries (default: 1000) */
  baseDelayMs?: number;
  /** Maximum delay cap in ms (default: 10000) */
  maxDelayMs?: number;
  /** Custom function to determine if error is retryable */
  shouldRetry?: (error: unknown) => boolean;
  /** Callback invoked on each retry attempt */
  onRetry?: (attempt: number, maxAttempts: number, error: unknown) => void;
}

/**
 * Dash Platform-specific transient error patterns that should be retried
 */
const PLATFORM_TRANSIENT_ERRORS = [
  // Tenderdash availability
  'tenderdash is not available',
  'tenderdash unavailable',
  // gRPC/DAPI errors
  'unavailable',
  'deadline exceeded',
  'resource exhausted',
  'aborted',
  'internal error',
  'unknown error',
  // Platform state sync errors
  'state transition broadcast error',
  'broadcast error',
  'consensus error',
  // Node connectivity
  'no available addresses',
  'failed to connect',
  'connection refused',
  'connection reset',
  'socket hang up',
  'epipe',
  'econnreset',
  // Temporary failures
  'temporarily unavailable',
  'try again',
  'retry',
  'busy',
  // SDK/WASM errors that may be transient
  'wasm',
  'memory',
];

/**
 * Extract error message from various error types including WASM SDK errors
 *
 * Handles:
 * - Standard Error objects
 * - WASM SDK errors (with __wbg_ptr)
 * - Objects with message property
 * - Strings
 * - Other values
 */
export function extractErrorMessage(error: unknown): string {
  // Handle null/undefined
  if (error == null) {
    return 'An unknown error occurred';
  }

  // Handle string errors directly
  if (typeof error === 'string') {
    return error;
  }

  // Handle Error-like objects
  if (typeof error === 'object') {
    // Check for WASM SDK error structure (has __wbg_ptr and message)
    const errObj = error as Record<string, unknown>;

    // Extract message from various properties
    if ('message' in errObj && typeof errObj.message === 'string' && errObj.message) {
      return errObj.message;
    }

    // Some errors have 'msg' instead of 'message'
    if ('msg' in errObj && typeof errObj.msg === 'string' && errObj.msg) {
      return errObj.msg;
    }

    // Check for error property that might contain the actual message
    if ('error' in errObj) {
      if (typeof errObj.error === 'string') {
        return errObj.error;
      }
      if (typeof errObj.error === 'object' && errObj.error !== null) {
        return extractErrorMessage(errObj.error);
      }
    }

    // Check for cause chain
    if ('cause' in errObj && errObj.cause) {
      const causeMsg = extractErrorMessage(errObj.cause);
      if (causeMsg !== 'An unknown error occurred') {
        return causeMsg;
      }
    }

    // Check for name property to provide some context
    if ('name' in errObj && typeof errObj.name === 'string') {
      // Look for additional context
      if ('code' in errObj) {
        return `${errObj.name}: code ${errObj.code}`;
      }
      if ('kind' in errObj) {
        return `${errObj.name}: kind ${errObj.kind}`;
      }
      return errObj.name;
    }

    // Standard Error object
    if (error instanceof Error) {
      return error.message || error.toString();
    }

    // Try to stringify if nothing else works
    try {
      const str = JSON.stringify(error);
      if (str !== '{}') {
        // Truncate long JSON strings
        return str.length > 200 ? str.substring(0, 200) + '...' : str;
      }
    } catch {
      // JSON.stringify failed
    }
  }

  // Fallback: convert to string
  const str = String(error);
  return str === '[object Object]' ? 'An unknown error occurred' : str;
}

/**
 * Check if an error is a retryable network/transient error
 *
 * This function checks for:
 * 1. Standard network errors (fetch failures, timeouts)
 * 2. HTTP status codes that indicate transient failures (5xx, 429)
 * 3. Dash Platform-specific transient errors (Tenderdash, gRPC, etc.)
 * 4. WASM SDK errors that may be transient
 */
export function isRetryableError(error: unknown): boolean {
  // Extract the error message to check against patterns
  const message = extractErrorMessage(error).toLowerCase();

  // Check for Platform-specific transient errors first
  for (const pattern of PLATFORM_TRANSIENT_ERRORS) {
    if (message.includes(pattern)) {
      return true;
    }
  }

  // Check for 'retriable' property in SDK errors (some SDK errors explicitly mark themselves)
  if (error && typeof error === 'object') {
    const errObj = error as Record<string, unknown>;
    // Some SDK errors have retriable: true
    if ('retriable' in errObj && errObj.retriable === true) {
      return true;
    }
    // Check for specific error codes that are retriable
    if ('code' in errObj) {
      const code = errObj.code;
      // gRPC error codes that are retriable
      // UNAVAILABLE (14), DEADLINE_EXCEEDED (4), RESOURCE_EXHAUSTED (8), ABORTED (10)
      if (code === 14 || code === 4 || code === 8 || code === 10) {
        return true;
      }
      // -1 is often a generic error that might be transient
      if (code === -1 && message.includes('not available')) {
        return true;
      }
    }
  }

  // Network errors from fetch (TypeError on network failure)
  if (error instanceof TypeError) {
    const typeErrorMsg = error.message.toLowerCase();
    if (
      typeErrorMsg.includes('network') ||
      typeErrorMsg.includes('fetch') ||
      typeErrorMsg.includes('failed to fetch') ||
      typeErrorMsg.includes('load failed') ||
      typeErrorMsg.includes('networkerror')
    ) {
      return true;
    }
  }

  // Check for common network error patterns
  if (error instanceof Error) {
    const errorMsg = error.message.toLowerCase();

    // Network connectivity errors
    if (
      errorMsg.includes('err_internet_disconnected') ||
      errorMsg.includes('err_network') ||
      errorMsg.includes('econnreset') ||
      errorMsg.includes('econnrefused') ||
      errorMsg.includes('etimedout') ||
      errorMsg.includes('enotfound') ||
      errorMsg.includes('network request failed') ||
      errorMsg.includes('network error') ||
      errorMsg.includes('connection') ||
      errorMsg.includes('timeout')
    ) {
      return true;
    }

    // HTTP status codes that are retryable (from error messages)
    if (
      errorMsg.includes('500') ||
      errorMsg.includes('502') ||
      errorMsg.includes('503') ||
      errorMsg.includes('504') ||
      errorMsg.includes('429') || // Rate limit
      errorMsg.includes('internal server error') ||
      errorMsg.includes('bad gateway') ||
      errorMsg.includes('service unavailable') ||
      errorMsg.includes('gateway timeout')
    ) {
      return true;
    }
  }

  // DOMException for aborted requests (could be network-related)
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true;
  }

  return false;
}

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  // Exponential backoff: baseDelay * 2^attempt
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);

  // Cap at maxDelay
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);

  // Add jitter: random value between 0 and 50% of the delay
  const jitter = Math.random() * cappedDelay * 0.5;

  return Math.floor(cappedDelay + jitter);
}

/**
 * Execute a function with retry logic
 *
 * @param fn - Async function to execute
 * @param options - Retry configuration options
 * @returns The result of the function
 * @throws The last error if all retries fail
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 1000,
    maxDelayMs = 10000,
    shouldRetry = isRetryableError,
    onRetry,
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if we should retry
      const isLastAttempt = attempt === maxAttempts - 1;
      if (isLastAttempt || !shouldRetry(error)) {
        throw error;
      }

      // Calculate delay for next attempt
      const delay = calculateDelay(attempt, baseDelayMs, maxDelayMs);

      // Notify via callback
      if (onRetry) {
        onRetry(attempt + 1, maxAttempts, error);
      }

      // Log retry attempt
      console.warn(
        `Retry ${attempt + 1}/${maxAttempts} after ${delay}ms:`,
        error instanceof Error ? error.message : error
      );

      // Wait before next attempt
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // Should not reach here, but just in case
  throw lastError;
}

/**
 * Create a retry wrapper with pre-configured options
 */
export function createRetryWrapper(defaultOptions: RetryOptions) {
  return <T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T> => {
    return withRetry(fn, { ...defaultOptions, ...options });
  };
}

/**
 * Default retry options for Dash Platform operations
 *
 * Platform operations (identity creation, top-up, DPNS) are more likely
 * to encounter transient errors from Tenderdash/DAPI, so we use more
 * aggressive retry settings.
 */
export const PLATFORM_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 5,
  baseDelayMs: 2000,
  maxDelayMs: 30000,
  shouldRetry: isRetryableError,
};

/**
 * Default retry options for Insight API operations
 *
 * Insight operations (UTXO queries, broadcast) are generally more reliable
 * and use standard retry settings.
 */
export const INSIGHT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  shouldRetry: isRetryableError,
};

/**
 * Create retry options with UI feedback callback
 *
 * @param updateRetryStatus - Callback to update UI with retry status
 * @param baseOptions - Base retry options to extend
 */
export function createRetryOptionsWithCallback(
  updateRetryStatus: (status: { isRetrying: boolean; attempt: number; maxAttempts: number; lastError?: string }) => void,
  baseOptions: RetryOptions = PLATFORM_RETRY_OPTIONS
): RetryOptions {
  return {
    ...baseOptions,
    onRetry: (attempt, maxAttempts, error) => {
      updateRetryStatus({
        isRetrying: true,
        attempt,
        maxAttempts,
        lastError: extractErrorMessage(error),
      });
      // Also log for debugging
      console.warn(
        `Retry ${attempt}/${maxAttempts}:`,
        extractErrorMessage(error)
      );
    },
  };
}
