// Convert between AgentTask and the single editable plan description on the card.

export interface PlanTask {
  goal: string;
  steps: string[];
}

/** The goal, a blank line, then the steps numbered, so the card reads as a plan. */
export function taskToDescription(task: PlanTask): string {
  if (task.steps.length === 0) return task.goal;
  return `${task.goal}\n\n${task.steps.map((step, i) => `${i + 1}. ${step}`).join('\n')}`;
}

/** First line is the goal; following lines are steps (optional "1." prefixes stripped). */
export function descriptionToTask(description: string): PlanTask {
  const lines = description
    .split('\n')
    .map((line) => line.replace(/^\s*\d+[.)]\s*/, '').trim())
    .filter(Boolean);
  if (lines.length === 0) return { goal: '', steps: [] };
  return { goal: lines[0]!, steps: lines.slice(1) };
}
