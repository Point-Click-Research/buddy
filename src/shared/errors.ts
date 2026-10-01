/** The message of whatever was thrown — an Error's, or the value itself as text. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
