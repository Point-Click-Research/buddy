// One request's tool registry, assembled the same way for a spoken guide
// turn, a text from the phone, and a headless background run — the
// difference is what the situation can honestly offer. A headless run has no
// screen to draw on, no field to type into, and nobody watching a total or a
// diff, so annotation, drafting, purchase, media, and coding tools stay out.
// A text has nobody at the screen either, but the Mac is Buddy's to drive, so
// media and coding stay in.

import { ensureMe } from '../account/api';
import { talkOnly } from '../account/plan-gate';
import { addBrowserTabsTool } from '../apple/browser-tabs';
import { addContactsTool } from '../apple/contacts';
import { addFileSearchTool } from '../apple/file-search';
import { addMailTool } from '../apple/mail';
import { addMessagesTool } from '../apple/messages';
import { addNotesTool } from '../apple/notes';
import { addShortcutsTool } from '../apple/shortcuts';
import type { ScreenshotMeta } from '../capture';
import { addCodingTools } from '../code/tools';
import { CODING_TOOL_NAMES } from '../code/workspace';
import { addComposioTools } from '../composio/apps';
import { addJobTools } from '../jobs/tool';
import { addMcpTools } from '../mcp/manager';
import { addMediaControlTool } from '../media';
import { addRunCommandTool } from '../run-command';
import { disabledBuiltinToolNames } from '../settings';
import { addCatalogTool } from '../shopify/catalog';
import { addPlaceSearchTools } from '../exa/place-search';
import { addProductSearchTool } from '../exa/product-search';
import { addContextTools, addMemoryTool } from './context-tools';
import { addOpenSettingsTool } from './open-settings';
import { createAnnotationTools, type ToolRegistry } from './tools';

export interface AssembledTools {
  tools: ToolRegistry;
  /** Registry names off for this turn, for the prompt's teaching bullets. */
  disabledTools: Set<string>;
}

export async function assembleTools(options: {
  /** Bind the annotation tools to these screenshots (foreground, eyes on). */
  screenshots?: ScreenshotMeta[];
  /** A background run: no drawing, drafting, buying, media, or coding. */
  headless?: boolean;
  /** A text from the phone: no drawing, drafting, or Settings, but media and coding. */
  remote?: boolean;
}): Promise<AssembledTools> {
  // Which of Buddy's keys the Apps and search tools can lean on, and the
  // plan. Cached after the first answer; only the first turn after signing in waits.
  await ensureMe();
  // The waitlist talks to Buddy and nothing more; memory is the one tool.
  if (talkOnly()) {
    const tools: ToolRegistry = new Map();
    addMemoryTool(tools);
    return { tools, disabledTools: new Set() };
  }
  const atScreen = !options.headless && !options.remote;
  const tools: ToolRegistry =
    atScreen && options.screenshots ? createAnnotationTools(options.screenshots, true) : new Map();
  addMcpTools(tools);
  addComposioTools(tools);
  addCatalogTool(tools);
  addProductSearchTool(tools);
  addPlaceSearchTools(tools);
  addContextTools(tools, { canInsertDraft: atScreen });
  addContactsTool(tools);
  addFileSearchTool(tools);
  addMessagesTool(tools);
  addMailTool(tools);
  addNotesTool(tools);
  addShortcutsTool(tools);
  addRunCommandTool(tools);
  addBrowserTabsTool(tools);
  addJobTools(tools, { headless: Boolean(options.headless) });
  if (!options.headless) {
    if (atScreen) addOpenSettingsTool(tools);
    addMediaControlTool(tools);
    await addCodingTools(tools);
  }
  // Built-in tools switched off in Settings → Tools leave the registry (and,
  // via disabledTools, the prompt sections that teach them).
  const disabledTools = disabledBuiltinToolNames();
  for (const name of disabledTools) tools.delete(name);
  // No workspace folder chosen means the coding tools were never registered;
  // count them as off so the prompt doesn't teach tools that don't exist.
  if (!tools.has('edit_file')) for (const name of CODING_TOOL_NAMES) disabledTools.add(name);
  return { tools, disabledTools };
}
