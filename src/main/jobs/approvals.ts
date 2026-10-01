// Resolving a parked write from the job's conversation. Allow replays the exact call
// the user just read — the same tool, the same input — with the asking
// already answered yes; Always allow also writes the permission override so
// that tool never parks again. The result lands in the job's thread.

import type { ToolOutcome } from '../ai/tools';
import { assembleTools } from '../ai/turn-tools';
import { recordExchangeIn } from '../chat/conversations';
import { runWithConfirmPolicy } from '../mcp/confirm-policy';
import { setPermissionOverride } from '../mcp/config';
import { takeApproval } from './store';

export type ApprovalDecision = 'once' | 'always' | 'deny';

/** What the replayed call reported, and whether it worked; empty when denied or already resolved. */
export async function resolveApproval(
  id: string,
  decision: ApprovalDecision,
): Promise<{ ok: boolean; result: string }> {
  const approval = takeApproval(id);
  if (!approval || decision === 'deny') return { ok: true, result: '' };
  if (decision === 'always' && approval.always) {
    setPermissionOverride(approval.always.serverId, approval.always.toolName, 'allow');
  }
  // The user approved this exact call, so every local ability may exist for
  // the replay; only the recorded tool runs, with the recorded input.
  const { tools } = await assembleTools({ headless: true });
  const tool = tools.get(approval.toolName);
  const outcome: ToolOutcome = tool
    ? await runWithConfirmPolicy(
        () => true,
        async () => tool.execute(approval.input, new AbortController().signal),
      )
    : { content: 'That tool is no longer available.', isError: true };
  const result = outcomeText(outcome);
  recordExchangeIn(approval.conversationId, `Approved: ${approval.title}`, result, []);
  return { ok: !outcome.isError, result };
}

function outcomeText(outcome: ToolOutcome): string {
  if (typeof outcome.content === 'string') return outcome.content;
  return outcome.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .filter(Boolean)
    .join('\n');
}
