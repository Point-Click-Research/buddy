// The typed errors providers return instead of throwing, silently retrying,
// or routing an action through a different provider. Each code carries a
// one-line recovery hint that goes into the tool result, so the model can
// fix its own next call without a round trip through the user.

export type ComputerErrorCode =
  | 'STALE_FRAME'
  | 'STALE_OBSERVATION'
  | 'WINDOW_NOT_READ'
  | 'UNSUPPORTED_ACTION'
  | 'UNSUPPORTED_KEY'
  | 'UNSUPPORTED_DISPLAY'
  | 'REFUSED'
  | 'OFF_VIEW'
  | 'PERMISSION_MISSING'
  | 'DRIVER_UNAVAILABLE'
  | 'INVALID_REQUEST';

const HINTS: Record<ComputerErrorCode, string> = {
  STALE_FRAME: 'Take a fresh screenshot and use its frameId for coordinate actions.',
  STALE_OBSERVATION: 'Observe that window again and use the refs from the new observation.',
  WINDOW_NOT_READ:
    'Call get_window_state for that window first. Act on an element ref if there is one; if its ' +
    'elements do not cover what you want, the same coordinate will be accepted next time.',
  UNSUPPORTED_ACTION: 'This provider cannot do that. Use one of the actions in the tool schema.',
  UNSUPPORTED_KEY: 'Send that character through the type action instead of key.',
  UNSUPPORTED_DISPLAY: 'Only the primary display can be driven; ask the user to move the window there.',
  REFUSED: 'Observe again and try a different route, or use ask_user. Do not repeat this action.',
  OFF_VIEW:
    'Scroll it into view first: scroll with the pointer inside the window (10 clicks is a screenful) ' +
    'or key Page Down, read the window again, then act on it.',
  PERMISSION_MISSING: 'Tell the user which macOS permission is missing and stop the task.',
  DRIVER_UNAVAILABLE: 'The computer driver is not running. Tell the user and stop the task.',
  INVALID_REQUEST: 'Re-read the action schema and send corrected arguments.',
};

export interface ComputerError {
  code: ComputerErrorCode;
  /** What went wrong, in one sentence. */
  detail: string;
  /** How to recover, from the table above. */
  hint: string;
}

export function computerError(code: ComputerErrorCode, detail: string): ComputerError {
  return { code, detail, hint: HINTS[code] };
}

/** The single line that goes back to the model as the tool result text. */
export function formatComputerError(error: ComputerError): string {
  return `${error.code}: ${error.detail} ${error.hint}`;
}
