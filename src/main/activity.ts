// The shimmer pill: what Buddy is doing between speeches ("Searching…",
// "Thinking…"), shown as a shimmering pill by the cursor. Cleared the moment
// Buddy starts talking — the words themselves are the status from then on.
// Shared by guide turns, follow-along steps and agent tasks, so the pill has
// one vocabulary wherever the work happens.

import { broadcast } from './windows';
import { IpcChannels } from '../shared/ipc';

/** The tools whose wait is worth naming; anything else gets a generic label. */
const ACTIVITY_LABELS: Record<string, string> = {
  read_window: 'Reading the window…',
  list_windows: 'Reading the window…',
  expand_element: 'Reading the window…',
  get_window_state: 'Reading the window…',
  locate_text: 'Finding it on screen…',
  read_document: 'Reading the document…',
  insert_draft: 'Typing it in…',
  find_contact: 'Looking up the contact…',
  search_files: 'Searching your files…',
  mail: 'Checking Mail…',
  notes: 'Checking Notes…',
  list_shortcuts: 'Listing shortcuts…',
  run_shortcut: 'Running a shortcut…',
  run_command: 'Running a command…',
  browser_tabs: 'Checking your tabs…',
  // Streaming a big draw call is seconds of otherwise-unexplained silence;
  // the label goes up as the block starts, while the shapes are still coming.
  draw: 'Drawing…',
  update_drawing: 'Drawing…',
  erase: 'Drawing…',
  point: 'Pointing…',
  // Agent tasks: the computer actions the pill narrates while Buddy drives.
  screenshot: 'Looking at the screen…',
  zoom: 'Looking closer…',
  left_click: 'Clicking…',
  right_click: 'Clicking…',
  middle_click: 'Clicking…',
  double_click: 'Clicking…',
  triple_click: 'Clicking…',
  click_element: 'Clicking…',
  right_click_element: 'Clicking…',
  left_click_drag: 'Dragging…',
  mouse_move: 'Moving the pointer…',
  scroll: 'Scrolling…',
  type: 'Typing…',
  type_into: 'Typing…',
  set_value: 'Filling it in…',
  key: 'Pressing keys…',
  invoke_menu: 'Using the menu…',
  bring_to_front: 'Switching windows…',
  wait: 'Waiting for it to load…',
  wait_for: 'Waiting for it to load…',
  clipboard_set: 'Copying…',
};

export function activityLabel(name: string): string {
  const label = ACTIVITY_LABELS[name];
  if (label) return label;
  // Bland's tools (bland__create_call, bland__wait_for_call, bland__get_call_log):
  // placing the call, then the minutes spent on the line waiting for it to end.
  if (/(create|send|make)_?call$/i.test(name)) return 'Placing the call…';
  if (/wait_for_call|call_log/i.test(name)) return 'Call in progress…';
  if (/search|fetch|crawl|browse/i.test(name)) return 'Searching…';
  return 'Working…';
}

let lastActivity: string | null = null;

/** Show, change or clear the pill; repeats are not re-broadcast. */
export function setActivity(label: string | null): void {
  if (label === lastActivity) return;
  lastActivity = label;
  broadcast(IpcChannels.sessionActivity, label);
}
