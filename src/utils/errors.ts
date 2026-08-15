/**
 * Extract a human-readable message from an unknown caught value.
 * WasmSdkError is not a standard Error, so a plain `instanceof Error`
 * check misses it — fall back to any object with a `message` property.
 */
export function extractErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return error instanceof Error ? error.message : String(error);
}
