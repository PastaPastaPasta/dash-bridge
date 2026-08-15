/**
 * Withdrawal document lifecycle statuses. The validator quorum moves a
 * withdrawal through these states; the client only observes them.
 *
 * Kept in a leaf module (no SDK imports) so the eagerly-loaded UI layer can
 * use the constants without pulling the lazily-loaded platform chunk into
 * the main bundle.
 */
export const WithdrawalStatus = {
  QUEUED: 0,
  POOLED: 1,
  BROADCASTED: 2,
  COMPLETE: 3,
  EXPIRED: 4,
} as const;
