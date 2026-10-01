// The tools an agent task can call. Buddy's own `computer` tool is one entry
// whose `action` field names the provider action to run; everything else —
// MCP servers, connected apps, shopping, the terminal, coding, drawing, the
// control tools — registers itself the same way guide turns do.

import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { addContextTools } from '../ai/context-tools';
import { addLocateTextTool, locatedTextBox } from '../ai/locate-text';
import { toolArgs, toolDefinitions, type ToolOutcome, type ToolRegistry } from '../ai/tools';
import { addCodingTools } from '../code/tools';
import { addComposioTools } from '../composio/apps';
import type { ComputerDescriptor, ComputerProvider } from '../computer/provider';
import { addDrawingTools } from '../drawing/tools';
import { addPlaceSearchTools } from '../exa/place-search';
import { addProductSearchTool } from '../exa/product-search';
import { addMcpTools } from '../mcp/manager';
import { hasPaymentCard } from '../payment/card';
import { addFillPaymentTool } from '../payment/fill-tool';
import { addRecordPurchaseTool } from '../payment/purchase-tool';
import { addRunCommandTool } from '../run-command';
import { disabledBuiltinToolNames } from '../settings';
import { addCatalogTool } from '../shopify/catalog';
import type { AgentTaskMode } from '../../shared/types';
import { addAgentControlTools, type RemoteUser } from './control-tools';
import type { ActionGate } from './safety';
import { buildComputerTool } from './tool-schema';

export interface AgentRegistryDeps {
  /** Run one action of the `computer` tool, through the rails. */
  runAction(name: string, input: Record<string, unknown>): Promise<ToolOutcome>;
  gate: ActionGate;
  provider: ComputerProvider;
  /** The task's mode right now. */
  mode(): AgentTaskMode;
  /** What Buddy says when the task ends, kept on the chat handover line. */
  onComplete(summary: string): void;
  /** The user is on their phone, so the control tools text instead of speak. */
  remote?: RemoteUser;
}

export interface AgentRegistry {
  registry: ToolRegistry;
  /** What the model sees: the computer tool built for this provider, then the rest. */
  definitions: Tool[];
  /** Built-in tools the user switched off in Settings → Tools. */
  disabledTools: Set<string>;
}

export async function buildAgentRegistry(deps: AgentRegistryDeps): Promise<AgentRegistry> {
  const { provider, gate } = deps;
  const descriptor: ComputerDescriptor = provider.descriptor();
  const registry: ToolRegistry = new Map();

  // The placeholder is dispatch only; the model's definition is built from
  // the provider's descriptor below.
  const placeholder = { name: 'computer', input_schema: { type: 'object' } } as unknown as Tool;
  registry.set('computer', {
    definition: placeholder,
    execute: (input) => {
      const { action, ...rest } = toolArgs(input);
      return deps.runAction(String(action ?? ''), rest);
    },
  });
  addMcpTools(registry);
  addComposioTools(registry);
  addCatalogTool(registry);
  addProductSearchTool(registry);
  addPlaceSearchTools(registry);
  addRunCommandTool(registry);
  await addCodingTools(registry);
  addContextTools(registry, { canInsertDraft: false });
  // Built-in tools switched off in Settings → Tools stay out of agent runs too.
  const disabledTools = disabledBuiltinToolNames();
  for (const name of disabledTools) registry.delete(name);
  addAgentControlTools(registry, {
    gate,
    screenshot: () => provider.snapshot(),
    onComplete: deps.onComplete,
    mode: deps.mode,
    ...(deps.remote ? { remote: deps.remote } : {}),
  });
  // Card checkouts: only with a saved card and a provider that can act by
  // ref — the digits go element-addressed, never through coordinates.
  if (hasPaymentCard() && descriptor.families.includes('element')) {
    addFillPaymentTool(registry, { provider: () => provider, gate });
  }
  // An order placed anywhere is filed, as the volume Buddy drives.
  addRecordPurchaseTool(registry, deps.mode);
  // Drawing in agent mode: the same tool, anchored to the elements this
  // task is already reading — or to text located by OCR — so Buddy can
  // show what it is about to touch.
  addLocateTextTool(registry);
  addDrawingTools(registry, {
    element: (id, ref) => locatedTextBox(id, ref) ?? provider.elementBox(id, ref),
  });

  const otherDefinitions = toolDefinitions(registry).filter((tool) => tool !== placeholder);

  // Models sometimes call an action as a tool of its own (click_element
  // {element: …} instead of computer {action: "click_element", …}). Route
  // those through the same rails rather than answering "Unknown tool" and
  // losing the step. Dispatch only: they never appear among the definitions.
  for (const action of descriptor.actions) {
    if (registry.has(action)) continue;
    registry.set(action, {
      definition: { ...placeholder, name: action } as Tool,
      execute: (input) => deps.runAction(action, toolArgs(input)),
    });
  }
  return { registry, definitions: [buildComputerTool(descriptor), ...otherDefinitions], disabledTools };
}
