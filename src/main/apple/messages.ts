// The send_message tool: one iMessage, after the user confirms.
//
// "Text Sarah I'm running late" is find_contact then this — never a proposed
// agent task that drives the Messages window. Sending is consequential, so
// the existing confirmation card has to fire first. Messages' JXA dictionary
// is incomplete on recent macOS; AppleScript's `send … to participant` is
// the path that actually lands.

import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { type ToolOutcome, type ToolRegistry, toolArgs } from '../ai/tools';
import { createLogger } from '../log';
import { requestEditableConfirmation } from '../mcp/confirm';
import { resolveTurnFiles } from '../session/turn-files';
import { jxaErrorMessage, runAppleScript } from './jxa';

const log = createLogger('messages');

const TIMEOUT_MS = 20_000;

const SEND_MESSAGE: Tool = {
  name: 'send_message',
  description:
    'Send an iMessage. `to` is a phone number or email handle — get it from find_contact, ' +
    'never invent one. Shows a confirmation card first; if the user declines, do not send ' +
    'another way. Send-only: message history is not readable.',
  input_schema: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Phone number or email, from find_contact.' },
      name: {
        type: 'string',
        description: "The recipient's name as the user knows them, for the confirmation card.",
      },
      text: {
        type: 'string',
        description: 'The message, in the user\'s voice. Never a stand-in for a file ("[photo]"); files go in attachments.',
      },
      attachments: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Files to send along: one the user sent this turn, by its exact name, or one on this Mac, by its path ("~/Desktop/clip.mp3"). Anything goes over iMessage.',
      },
    },
    required: ['to', 'text'],
  },
};

/** Register send_message. A no-op off macOS. */
export function addMessagesTool(registry: ToolRegistry): void {
  if (process.platform !== 'darwin') return;
  registry.set('send_message', {
    definition: SEND_MESSAGE,
    waitsForUser: true,
    execute: sendMessage,
  });
}

async function sendMessage(input: unknown, signal: AbortSignal): Promise<ToolOutcome> {
  const args = toolArgs(input);
  const to = typeof args['to'] === 'string' ? args['to'].trim() : '';
  const name = typeof args['name'] === 'string' ? args['name'].trim() : '';
  const text = typeof args['text'] === 'string' ? args['text'].trim() : '';
  if (!to || !text) return { content: 'send_message needs to (a handle) and text.', isError: true };
  const resolved = resolveTurnFiles(args['attachments']);
  if ('error' in resolved) return { content: resolved.error, isError: true };
  const files = resolved.files;

  // "To Sanna Trolle (+13367404653)" — the user knows the name, not the number.
  const recipient = name ? `${name} (${to})` : to;
  const withFiles = files.length ? ` · with ${files.map((file) => file.name).join(', ')}` : '';
  // The card's text is editable: what sends is what the user approved.
  const edited = await requestEditableConfirmation(
    { title: 'Send this message?', detail: `To ${recipient}${withFiles}`, edit: { text, action: 'Send' } },
    signal,
  );
  if (edited === null) return { content: 'The user cancelled. Do not send it another way.' };
  const message = edited.trim() || text;
  try {
    await sendIMessage(to, message, files.map((file) => file.path));
    return {
      content:
        (message === text
          ? `Sent to ${recipient}.`
          : `Sent to ${recipient}. The user edited it on the card to: ${message}`) + withFiles.replace(' ·', ''),
    };
  } catch (error) {
    log.warn(`send_message failed: ${error instanceof Error ? error.message : error}`);
    return { content: jxaErrorMessage(error, 'Messages'), isError: true };
  }
}

/**
 * Where a file is sent from. Messages uploads an attachment from a
 * background daemon after the send call returns, and that daemon cannot
 * read a file in the Desktop, Documents, or a temp folder: the send
 * "succeeds" and the bubble says Not Delivered. So each file goes as a copy
 * in Messages' own attachments folder (Buddy has Full Disk Access for Text
 * Buddy), or in Pictures when that copy is refused. The copies are left for
 * the upload to finish and swept on the next launch.
 */
const SEND_FROM = [
  join(homedir(), 'Library', 'Messages', 'Attachments', 'Buddy'),
  join(homedir(), 'Pictures', 'Buddy'),
];

function copyForMessages(path: string): string {
  const folder = String(Date.now());
  for (const root of SEND_FROM) {
    try {
      const dir = join(root, folder);
      mkdirSync(dir, { recursive: true });
      const copy = join(dir, basename(path));
      copyFileSync(path, copy);
      return copy;
    } catch (error) {
      log.warn(`could not stage ${basename(path)} under ${root}: ${error instanceof Error ? error.message : error}`);
    }
  }
  return path;
}

/** At launch: yesterday's send copies are long uploaded. */
export function sweepMessagesCopies(): void {
  for (const root of SEND_FROM) rmSync(root, { recursive: true, force: true });
}

/**
 * Bring Messages to the front on its Settings window (the iMessage tab is
 * where the user splits their addresses). Messages has no URL for it, so it
 * is the app's own shortcut, pressed for them.
 */
export async function openMessagesSettings(): Promise<void> {
  await runAppleScript(
    `
    tell application "Messages" to activate
    delay 0.5
    tell application "System Events" to keystroke "," using command down
  `,
    TIMEOUT_MS,
  );
}

/** One iMessage, files first then the words, no card: the caller owns the asking. Throws what osascript threw. */
export async function sendIMessage(to: string, text: string, files: string[] = []): Promise<void> {
  // Values are JSON-stringified so quotes in the message can't break the script.
  const sends = [
    ...files.map(copyForMessages).map((path) => `send POSIX file ${JSON.stringify(path)} to targetBuddy`),
    `send ${JSON.stringify(text)} to targetBuddy`,
  ];
  await runAppleScript(
    `
    tell application "Messages"
      set targetService to id of 1st account whose service type = iMessage
      set targetBuddy to participant ${JSON.stringify(to)} of account id targetService
      ${sends.join('\n      ')}
    end tell
  `,
    TIMEOUT_MS,
  );
}
