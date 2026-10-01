// The per-task action log: every step with a small thumbnail, kept in memory
// for the session, streamed live to the panel, and saved to JSON on demand.
// Full screenshots and secrets are never logged — thumbnails and clipped args.

import { dialog, nativeImage } from 'electron';
import { writeFile } from 'fs/promises';
import { type AgentLogEntry } from '../../shared/types';
import { createLogger } from '../log';
import { broadcast } from '../windows';
import { IpcChannels } from '../../shared/ipc';

const log = createLogger('action-log');

const THUMBNAIL_WIDTH = 160;
const MAX_ARGS_CHARS = 300;
/** Enough of an element tree to see what the model was working from. */
const MAX_RESULT_CHARS = 2_000;

let entries: AgentLogEntry[] = [];

export function resetActionLog(): void {
  entries = [];
  broadcast(IpcChannels.agentLogReset);
}

export function getActionLog(): AgentLogEntry[] {
  return entries;
}

export function logAction(params: {
  action: string;
  input: unknown;
  reasoning: string;
  /** The text the model got back, before any image. */
  result: string;
  /** The post-action screenshot (base64 JPEG), if the action produced one. */
  screenshotBase64: string | null;
}): void {
  const entry: AgentLogEntry = {
    index: entries.length + 1,
    timestamp: Date.now(),
    action: params.action,
    args: clipArgs(params.input),
    reasoning: params.reasoning,
    result: clip(params.result, MAX_RESULT_CHARS),
    thumbnail: params.screenshotBase64 ? thumbnail(params.screenshotBase64) : '',
  };
  entries.push(entry);
  broadcast(IpcChannels.agentLogAppend, entry);
}

/** "Save log": ask where, write the entries as JSON. Returns the path or null. */
export async function saveActionLog(): Promise<string | null> {
  if (entries.length === 0) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const result = await dialog.showSaveDialog({ defaultPath: `buddy-agent-log-${stamp}.json` });
  if (result.canceled || !result.filePath) return null;
  await writeFile(result.filePath, JSON.stringify({ savedAt: new Date().toISOString(), entries }, null, 2));
  log.info(`saved ${entries.length} log entries to ${result.filePath}`);
  return result.filePath;
}

function clipArgs(input: unknown): string {
  return clip(JSON.stringify(input ?? {}), MAX_ARGS_CHARS);
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function thumbnail(base64: string): string {
  try {
    const image = nativeImage.createFromBuffer(Buffer.from(base64, 'base64'));
    return `data:image/jpeg;base64,${image.resize({ width: THUMBNAIL_WIDTH }).toJPEG(60).toString('base64')}`;
  } catch {
    return '';
  }
}
