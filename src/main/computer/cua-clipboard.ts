// The clipboard family: the driver's pasteboard write, so a task can place
// long text and paste it with cmd+v instead of typing it keystroke by
// keystroke where set_value is refused. Write-only by design — reading the
// clipboard is the consent-gated read_clipboard tool, which asks the user.

import { invalid, text, unsupported } from './args';
import { toError, type CuaIo } from './cua-io';
import type { ActionOutcome } from './provider';

/** Exported for tests; the provider is the only production caller. */
export async function runClipboardAction(
  name: string,
  input: Record<string, unknown>,
  io: CuaIo,
): Promise<ActionOutcome> {
  if (name !== 'clipboard_set') return unsupported(`"${name}" is not a clipboard action.`);
  const value = text(input['clipboard_text']);
  if (!value) return invalid('clipboard_set needs clipboard_text.');
  const result = await io.call('clipboard_write', { text: value });
  const failure = toError(result);
  return failure ? { error: failure } : { text: 'Copied to the clipboard. Paste it with key cmd+v.' };
}
