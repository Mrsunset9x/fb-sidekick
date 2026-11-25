/** User-facing next step; do not collapse an unknown outcome into a safe retry. */
export function deleteFeedback(reason?: string): string {
  if (reason === 'deletion-unverified') return 'deleteUnverified';
  if (reason === 'inbox-unavailable') return 'deleteInboxUnavailable';
  if (reason === 'row-missing') return 'deleteRowMissing';
  if (['options-missing', 'menu-missing', 'delete-action-missing', 'dialog-missing', 'confirm-missing'].includes(reason ?? '')) {
    return 'deleteControlsMissing';
  }
  return 'deleteFailed';
}

/** A short support code distinguishes failures without exposing page data. */
export function deleteFailureCode(reason?: string): string {
  return reason && /^[a-z]+(?:-[a-z]+){0,3}$/.test(reason) && reason.length <= 40 ? reason : 'unknown';
}
