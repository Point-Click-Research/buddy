/** Cut a long document so it still fits a model turn, and say so. */
export function truncateForModel(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const omitted = text.length - limit;
  return `${text.slice(0, limit)}\n\n[truncated — ${omitted} characters omitted]`;
}
