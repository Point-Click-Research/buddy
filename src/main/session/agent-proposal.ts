// The "do this" chord: what the user says becomes a proposed agent task, and
// the same strict plan approval as propose_task gates the start.

import { type RecordingResult } from '../../shared/types';
import type { AgentTask } from '../agent/agent';
import { approvePlan } from '../agent/control-tools';
import { agentHandoverTurns } from '../chat/agent-context';
import { recordExchange } from '../chat/conversations';
import { getSettings } from '../settings';
import { finishText, pushText, startSpeech } from '../speech/tts';
import { getState, setState } from '../state';
import { broadcast } from '../windows';
import { startAgentTask } from './guide-turn';
import { runSession, sayNothingHeard } from './lifecycle';
import { hear } from './listening';
import { IpcChannels } from '../../shared/ipc';

export function runAgentProposal(recording: RecordingResult): Promise<void> {
  return runSession(async (signal) => {
    const goal = await hear(recording, signal);
    if (signal.aborted) return;
    if (!goal) {
      sayNothingHeard();
      return;
    }

    broadcast(IpcChannels.sessionTranscript, goal);
    setState('thinking');

    const skipPlan = !getSettings().agentConfirmPlans;
    const speechActive = skipPlan
      ? false
      : startSpeech(
          signal,
          () => {
            if (getState() === 'speaking') setState('idle');
          },
          (caption) => broadcast(IpcChannels.sessionResponseDelta, `${caption} `),
        );
    if (speechActive) {
      pushText(` You want me to: ${goal}. Edit the plan on screen, then Start or say yes. `);
    }

    const task: AgentTask = { goal, steps: [], mode: 'watch' };
    const approved = await approvePlan(task, signal);
    if (signal.aborted) return;

    if (approved) {
      recordExchange(
        goal,
        `Started an agent task: ${approved.goal}`,
        agentHandoverTurns(goal, approved.goal, approved.steps),
        [],
        { agent: true },
      );
      // No drain here: what's still queued is the "say yes to start" prompt,
      // and they have just answered it.
      startAgentTask(approved, signal);
      return;
    }
    // Spoken, "Cancelled." reaches the caption when it is said; otherwise now.
    if (speechActive) pushText(' Cancelled. ');
    else broadcast(IpcChannels.sessionResponseDelta, 'Cancelled.');
    broadcast(IpcChannels.sessionResponseDone);
    if (speechActive && finishText()) {
      setState('speaking');
    } else {
      setState('idle');
    }
  });
}
