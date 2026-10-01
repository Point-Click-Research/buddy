import { describe, expect, it } from 'vitest';
import { parseRecipe, recipeToSkill, similarSkill } from '../src/main/agent/distill-recipe';

const SAMPLE = `name: send-slack-update
task: Post a {channel} update saying {message}
preconditions: Slack is signed in.
steps: Open Slack. Switch to {channel}. Type {message}. Send.
checks: The message appears in the channel.`;

describe('parseRecipe', () => {
  it('reads the name and task lines', () => {
    const parsed = parseRecipe(SAMPLE);
    expect(parsed).toEqual({
      name: 'send-slack-update',
      task: 'Post a {channel} update saying {message}',
      text: SAMPLE,
    });
  });

  it('rejects UNRELIABLE and empty text', () => {
    expect(parseRecipe('UNRELIABLE')).toBeNull();
    expect(parseRecipe('   ')).toBeNull();
    expect(parseRecipe('steps: no name here')).toBeNull();
  });

  it('sanitizes a messy name into kebab-case', () => {
    expect(parseRecipe('name: Send Slack Update!!\ntask: x')?.name).toBe('send-slack-update');
  });
});

describe('recipeToSkill', () => {
  it('opens with the task template so prompt matching can see it', () => {
    const skill = recipeToSkill(parseRecipe(SAMPLE)!, []);
    expect(skill.name).toBe('send-slack-update');
    expect(skill.instructions.startsWith('Post a {channel} update saying {message}.')).toBe(true);
    expect(skill.instructions).toContain('name: send-slack-update');
  });

  it('does not collide with an existing skill name, including built-ins', () => {
    const skill = recipeToSkill(parseRecipe(SAMPLE)!, ['send-slack-update', 'Shopping']);
    expect(skill.name).toBe('send-slack-update-2');
  });
});

describe('similarSkill', () => {
  const saved = recipeToSkill(
    parseRecipe(
      'name: text-edit-write-and-save\ntask: Write {content} in TextEdit and save it as {filename}\nsteps: Open TextEdit. Type it. Save.',
    )!,
    [],
  );

  it('recognizes a re-run of a saved skill with one parameter changed', () => {
    const rerun = parseRecipe(
      'name: text-edit-write-rap-and-save\ntask: Write a rap song in TextEdit and save it as rap.txt\nsteps: Open TextEdit. Type the rap. Save.',
    )!;
    expect(similarSkill(rerun, [saved])?.name).toBe(saved.name);
  });

  it('leaves a genuinely different workflow alone', () => {
    expect(similarSkill(parseRecipe(SAMPLE)!, [saved])).toBeNull();
  });

  it('is null with no skills saved', () => {
    expect(similarSkill(parseRecipe(SAMPLE)!, [])).toBeNull();
  });
});
