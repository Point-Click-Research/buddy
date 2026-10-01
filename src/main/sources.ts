// The sources one turn surfaces. Every tool result's links go out to the
// overlay and panel the moment they appear, and are kept here so the exchange
// being recorded can carry its sources into the conversation.

import { drivingMode } from './agent/safety';
import type { ToolOutcome } from './ai/tools';
import { extractLinks } from './links';
import { getState } from './state';
import { broadcast } from './windows';
import { IpcChannels } from '../shared/ipc';

const turnLinks = new Set<string>();

/**
 * Broadcast a tool result's links and keep them for the turn's record.
 * Headless runs (jobs, the morning suggestions) call the same tools, but
 * nobody asked anything on screen, so their links stay off the overlay.
 */
export function publishLinks(content: ToolOutcome['content']): void {
  const links = extractLinks(content);
  if (links.length === 0) return;
  if (getState() === 'idle' && drivingMode() === null) return;
  for (const link of links) turnLinks.add(link);
  broadcast(IpcChannels.sessionLinks, links);
}

/** Start a turn with a clean slate — an agent task may have run in between. */
export function resetTurnLinks(): void {
  turnLinks.clear();
}

/** The turn's links, for the exchange being recorded. Clears the slate. */
export function takeTurnLinks(): string[] {
  const links = [...turnLinks];
  turnLinks.clear();
  return links;
}
