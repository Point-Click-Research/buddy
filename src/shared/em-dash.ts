/** Buddy never shows or sends an em dash. A comma keeps the clause readable. */
export function withoutEmDash(text: string): string {
  return text.replaceAll(/\s*—\s*/g, ', ').replaceAll(/,\s*,+/g, ',').replace(/^,\s*/, '');
}
