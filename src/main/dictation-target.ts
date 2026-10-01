// Which window's field is taking dictation. Kept out of the session and
// window modules so those two can both use it without importing each other.

import type { WebContents } from 'electron';

let target: WebContents | null = null;

/** False when a blur belongs to some other window's field. */
export function noteDictationField(focused: boolean, contents: WebContents): boolean {
  if (!focused && target && contents.id !== target.id) return false;
  target = focused ? contents : null;
  return true;
}

export function dictationContents(): WebContents | null {
  return target && !target.isDestroyed() ? target : null;
}
