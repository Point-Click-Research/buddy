// What a finished agent task leaves in the model context. The display
// transcript keeps the full work log on the handover line; the next chat
// turn only sees MessageParam history, which the handover never wrote.
// This is that missing exchange: the request, what the user heard, the
// log, and every link the run produced (including ones that lived only
// in a tool result).

import type { MessageParam, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages';

/** The end of the log is what a follow-up needs. Longer runs keep that end. */
const WORK_LOG_LIMIT = 12_000;

const URL_PATTERN = /https?:\/\/[^\s<>"']+/g;

/**
 * The exchange written when a task is handed over, before it runs. The
 * display line alone never reaches the model, so without this a follow-up
 * ("do that again, but about Amanda") arrives with no task to change.
 */
export function agentHandoverTurns(userText: string, goal: string, steps: readonly string[]): MessageParam[] {
  const ask = userText.trim();
  const plan = [`Started an agent task: ${goal.trim() || ask || 'the request'}`];
  if (steps.length > 0) {
    plan.push(`Steps:\n${steps.map((step, index) => `${index + 1}. ${step}`).join('\n')}`);
  }
  return [
    { role: 'user', content: [{ type: 'text', text: ask || 'Agent task' }] },
    { role: 'assistant', content: [{ type: 'text', text: plan.join('\n\n') }] },
  ];
}

/**
 * One exchange for the conversation's model context. Empty when the run
 * left nothing a later turn could use.
 */
export function agentOutcomeTurns(
  userText: string,
  thought: string,
  said: string,
  toolText = '',
): MessageParam[] {
  const ask = userText.trim();
  const summary = said.trim();
  const fullLog = thought.trim();
  const links = uniqueLinks(`${fullLog}\n${toolText}`);
  const log = clipLog(fullLog);

  if (!ask && !summary && !log.text && links.length === 0) return [];

  const lines = ['I finished an agent task for that request.'];
  if (summary) lines.push('', `What I told the user: ${summary}`);
  if (links.length > 0) {
    lines.push('', 'Links from the task:', ...links.map((url) => `- ${url}`));
  }
  if (log.text) {
    lines.push('', log.trimmed ? 'Work log (earlier part trimmed):' : 'Work log:', log.text);
  } else if (!summary) {
    lines.push('', 'The task ended before it reported anything.');
  }

  return [
    { role: 'user', content: [{ type: 'text', text: ask || 'Agent task' }] },
    { role: 'assistant', content: [{ type: 'text', text: lines.join('\n') }] },
  ];
}

/** Text of every tool result in a finished run, images left out. */
export function toolResultText(turns: MessageParam[]): string {
  const parts: string[] = [];
  for (const message of turns) {
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block.type !== 'tool_result') continue;
      const text = resultText(block.content);
      if (text) parts.push(text);
    }
  }
  return parts.join('\n');
}

function resultText(content: ToolResultBlockParam['content']): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  return content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .filter(Boolean)
    .join('\n');
}

function uniqueLinks(text: string): string[] {
  const seen = new Set<string>();
  const links: string[] = [];
  for (const raw of text.match(URL_PATTERN) ?? []) {
    const url = raw.replace(/[)\].,>;]+$/g, '');
    if (!url || seen.has(url)) continue;
    seen.add(url);
    links.push(url);
  }
  return links;
}

function clipLog(log: string): { text: string; trimmed: boolean } {
  if (log.length <= WORK_LOG_LIMIT) return { text: log, trimmed: false };
  const tail = log.slice(-WORK_LOG_LIMIT);
  const line = tail.indexOf('\n');
  const text = (line >= 0 && line < 400 ? tail.slice(line + 1) : tail).trim();
  return { text, trimmed: true };
}
