// Guide-mode tools for documents, memories, skills, drafts, and past chats.

import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { app as electronApp } from 'electron';
import { aboutMeText, addShopperEntry, getSettings } from '../settings';
import { broadcastSettings } from '../settings-view';
import { publishLinks } from '../sources';
import {
  AutomationDenied,
  frontmostAppName,
  frontmostBrowserUrl,
  frontmostDocumentPath,
} from '../reader/frontmost';
import { readLocalDocument, resolveLocalPath } from '../reader/file';
import { truncateForModel } from '../reader/truncate';
import { namesFenced } from '../vault-fence';
import { fetchPageText } from '../reader/web';
import { productBrowseInstruction } from '../../shared/product-browse';
import { canCheckout } from '../payment/checkout';
import { SHOPPER_CATEGORIES, type ShopperCategory } from '../../shared/types';
import { getConversation, latestAgentTask, listRecentConversations } from '../chat/conversations';
import { insertDraft } from './insert-draft';
import { toolArgs, type ToolOutcome, type ToolRegistry } from './tools';
import { errorMessage } from '../../shared/errors';

export interface ContextToolOptions {
  canInsertDraft: boolean;
}

/** save_memory alone: what a talk-only turn keeps, so Buddy still learns who they are. */
export function addMemoryTool(registry: ToolRegistry): void {
  registry.set('save_memory', {
    definition: SAVE_MEMORY,
    execute: (input) => saveMemoryTool(input),
  });
}

export function addContextTools(registry: ToolRegistry, options: ContextToolOptions): void {
  registry.set('read_document', {
    definition: READ_DOCUMENT,
    execute: () => readFrontmostDocument(),
  });
  addMemoryTool(registry);
  registry.set('get_skill', {
    definition: GET_SKILL,
    execute: (input) => getSkillTool(input),
  });
  registry.set('get_about_me', {
    definition: GET_ABOUT_ME,
    execute: () => aboutMeOutcome(),
  });
  registry.set('list_conversations', {
    definition: LIST_CONVERSATIONS,
    execute: (input) => listConversationsTool(input),
  });
  registry.set('read_conversation', {
    definition: READ_CONVERSATION,
    execute: (input) => readConversationTool(input),
  });
  if (options.canInsertDraft) {
    registry.set('insert_draft', {
      definition: INSERT_DRAFT,
      execute: (input, signal) => runInsertDraft(input, signal),
    });
  }
}

const READ_DOCUMENT: Tool = {
  name: 'read_document',
  description:
    'Read the whole frontmost document, web page, or file — not just what is visible on screen. ' +
    'Use it when they ask about a PDF, a page, a file, or "this document".',
  input_schema: { type: 'object', properties: {} },
};

const SAVE_MEMORY: Tool = {
  name: 'save_memory',
  description:
    'Save a durable fact to a shopper profile: a shopping, travel, or dining preference, a size, ' +
    'an address, a birthday, anything worth remembering. Pass shopper (whose fact it is) and ' +
    'category; an unknown name starts a new profile. Never store secrets, passwords, or payment cards.',
  input_schema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: "One short fact, in the user's words." },
      shopper: {
        type: 'string',
        description:
          'Whose fact this is: "me" for the user themselves (never their real name — that would ' +
          'start a second profile), a profile name, or the name a speaker introduced themselves ' +
          'with. Defaults to "me".',
      },
      category: {
        type: 'string',
        enum: ['products', 'travel', 'dining', 'formFacts', 'general'],
        description: 'Which kind of fact it is. Defaults to general.',
      },
    },
    required: ['text'],
  },
};

const GET_SKILL: Tool = {
  name: 'get_skill',
  description:
    'Load a named skill: instructions the user saved for how they want something done — ' +
    'a writing style, a routine, a workflow. Load it before doing what it covers.',
  input_schema: {
    type: 'object',
    properties: { name: { type: 'string', description: 'The skill name, exactly as listed.' } },
    required: ['name'],
  },
};

const GET_ABOUT_ME: Tool = {
  name: 'get_about_me',
  description:
    "Return the user's saved About me facts (name, email, phone, address, company, and similar). " +
    'Empty if nothing is saved. Passwords, payment cards, and government IDs are never stored here.',
  input_schema: { type: 'object', properties: {} },
};

const LIST_CONVERSATIONS: Tool = {
  name: 'list_conversations',
  description:
    'List recent chat conversations, newest first, each with its id and title, and name the last agent task. ' +
    'Use it when they refer to something from another chat ("the sneakers we discussed", "last time") or ask what the last agent task was. ' +
    'The first line is that task; answer "what was the last agent task" from it. A title is only the topic. ' +
    'Then call read_conversation on the best match.',
  input_schema: {
    type: 'object',
    properties: {
      limit: { type: 'integer', description: 'How many to list, newest first. Defaults to 10.' },
    },
  },
};

const READ_CONVERSATION: Tool = {
  name: 'read_conversation',
  description:
    "Read one past conversation's transcript by its id from list_conversations. " +
    'Use it to pick up what was discussed or decided there, like a product name or a link. ' +
    'The current conversation is already in context, so never call this on it.',
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The conversation id from list_conversations.' },
      limit: { type: 'integer', description: 'How many of the latest messages to read. Defaults to 30.' },
    },
    required: ['id'],
  },
};

const INSERT_DRAFT: Tool = {
  name: 'insert_draft',
  description:
    'Type a draft straight into the text field the user has focused, where they can edit it. ' +
    'Use it when they ask you to write or type a reply. To revise a draft you already inserted, ' +
    'call it again with the complete revised text and replaces_draft: true — the old draft is ' +
    'swapped out, never typed over or into.',
  input_schema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The draft to insert (or the complete revised draft).' },
      replaces_draft: {
        type: 'boolean',
        description:
          'True when this text revises the draft inserted earlier this conversation: ' +
          'the old draft is replaced instead of typing at the cursor.',
      },
    },
    required: ['text'],
  },
};

function aboutMeOutcome(): ToolOutcome {
  return { content: aboutMeText() || 'No About me facts are saved.' };
}

/** A transcript longer than this is a whole shopping session; the tail is what matters. */
const CONVERSATION_READ_LIMIT = 12_000;

/** A model-supplied count (number or numeric string), bounded; the fallback when absent or junk. */
function clampLimit(value: unknown, fallback: number, max: number): number {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function listConversationsTool(input: unknown): ToolOutcome {
  const args = toolArgs(input);
  const recent = listRecentConversations(clampLimit(args['limit'], 10, 20));
  const last = latestAgentTask();
  const head = last
    ? `Last agent task: "${last.goal}"${last.current ? ' (this conversation).' : ` in "${last.title}" (id: ${last.id}).`}`
    : 'No agent task in any saved conversation.';
  if (recent.length === 0) return { content: head };
  const lines = recent.map((entry) => {
    const when = new Date(entry.updatedAt).toISOString().slice(0, 10);
    const task = entry.agentTask ? `, agent task: ${entry.agentTask}` : '';
    return `- ${entry.title} (id: ${entry.id}, ${entry.messageCount} messages, ${when}${task})`;
  });
  return { content: `${head}\n${lines.join('\n')}` };
}

function readConversationTool(input: unknown): ToolOutcome {
  const args = toolArgs(input);
  const id = typeof args['id'] === 'string' ? args['id'].trim() : '';
  if (!id) return { content: 'Pass the conversation id from list_conversations.', isError: true };
  const view = getConversation(id);
  if (!view) {
    return { content: 'No conversation with that id. Call list_conversations for a fresh id.', isError: true };
  }
  const tail = view.messages.slice(-clampLimit(args['limit'], 30, 60));
  if (tail.length === 0) return { content: `${view.title}: no messages yet.` };
  const lines = tail.map((message) => {
    const who = message.role === 'user' ? 'User' : 'Buddy';
    // A handover line only says a task started; what the task did is in `said`.
    const outcome = message.agent?.said ? `\n  Outcome: ${message.agent.said}` : '';
    const links = message.links?.length ? `\n  Links: ${message.links.join(', ')}` : '';
    return `${who}: ${message.text}${outcome}${links}`;
  });
  const text = `${view.title} (${view.messages.length} messages):\n${lines.join('\n')}`;
  return { content: truncateForModel(text, CONVERSATION_READ_LIMIT) };
}

function saveMemoryTool(input: unknown): ToolOutcome {
  const args = toolArgs(input);
  const text = typeof args['text'] === 'string' ? args['text'] : '';
  const shopper = (typeof args['shopper'] === 'string' && args['shopper'].trim()) || 'me';
  const category = args['category'];
  try {
    addShopperEntry(shopper, isShopperCategory(category) ? category : 'general', text);
    broadcastSettings(); // the Memory page (if open) re-renders from the view
    return { content: `saved to ${shopper}` };
  } catch (error) {
    return { content: errorMessage(error), isError: true };
  }
}

function isShopperCategory(value: unknown): value is ShopperCategory {
  return SHOPPER_CATEGORIES.some(({ key }) => key === value);
}

function getSkillTool(input: unknown): ToolOutcome {
  const name =
    typeof input === 'object' && input && 'name' in input ? String(input.name).trim() : '';
  const skills = getSettings().skills;
  const match = skills.find((skill) => skill.name.toLowerCase() === name.toLowerCase());
  if (match && !match.disabled) {
    // Find Products chooses one-at-a-time or a tab dump. The stored skill
    // stays the shared steps; the live choice is appended so an edited copy
    // still follows the switch.
    const pace =
      match.name.toLowerCase() === 'shopping'
        ? `\n\n${productBrowseInstruction(getSettings().productBrowse, canCheckout())}`
        : '';
    return { content: `${match.instructions}${pace}` };
  }
  // A disabled skill is the user's explicit "not this one" — never follow it.
  if (match) {
    return {
      content: `The skill "${match.name}" is disabled in Settings → Skills, so do not follow it.`,
      isError: true,
    };
  }
  const names =
    skills.filter((skill) => !skill.disabled).map((skill) => skill.name).join(', ') || '(none saved)';
  return { content: `No skill named "${name}". Available: ${names}`, isError: true };
}

async function runInsertDraft(input: unknown, signal: AbortSignal): Promise<ToolOutcome> {
  const args = toolArgs(input);
  const text = typeof args['text'] === 'string' ? args['text'] : '';
  return insertDraft(text, args['replaces_draft'] === true, signal);
}

async function readFrontmostDocument(): Promise<ToolOutcome> {
  if (process.platform !== 'darwin') {
    return { content: 'Reading the frontmost document is only available on macOS.', isError: true };
  }
  const limit = getSettings().documentReadLimit;
  try {
    const url = await frontmostBrowserUrl();
    if (url) {
      const text = truncateForModel(await fetchPageText(url), limit);
      return publish(`${url}\n\n${text}`);
    }

    const rawPath = await frontmostDocumentPath();
    const path = rawPath ? resolveLocalPath(rawPath) : null;
    // Buddy's own data folder (the encrypted card and keys) is never read
    // into the model's context, even when the user has a file from it open.
    if (path && !namesFenced(path, [electronApp.getPath('userData')])) {
      const text = truncateForModel(await readLocalDocument(path), limit);
      return { content: `${path}\n\n${text}` };
    }

    const app = (await frontmostAppName()) || 'the frontmost app';
    return {
      content:
        `${app} doesn't publish a document or page I can read in full, so the screenshot is ` +
        'all I have. Answer from that, and say you are going by what is visible.',
      isError: true,
    };
  } catch (error) {
    return failure(error);
  }
}

/** A refused Apple Event is a fixable permission problem, not a dead end. */
function failure(error: unknown): ToolOutcome {
  if (error instanceof AutomationDenied) return { content: error.message, isError: true };
  return { content: errorMessage(error), isError: true };
}

function publish(content: string): ToolOutcome {
  publishLinks(content);
  return { content };
}
