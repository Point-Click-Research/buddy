import { describe, expect, it } from 'vitest';
import {
  looksLikeATask,
  looksLikeMediaCommand,
  looksLikeMemoryRequest,
  needsDeepModel,
  pickModel,
} from '../src/main/ai/router';

describe('needsDeepModel', () => {
  it('keeps short lookups on the fast model', () => {
    for (const question of [
      'what does this say',
      'where is the share button',
      'read me that paragraph',
      'who sent this',
      'is this saved',
      'what am I looking at',
    ]) {
      expect(needsDeepModel(question), question).toBe(false);
    }
  });

  it('sends reasoning, diagnosis and multi-step questions to the deep model', () => {
    for (const question of [
      'why is this failing',
      // Naming an error almost always leads straight to "so how do I fix it".
      "what's this error message",
      'how do I export this as a PDF',
      'walk me through setting up the deploy',
      'explain what this function is doing',
      'which one of these plans is better',
      'give me turn by turn directions from Market to Valencia',
      'compare these two invoices',
      'summarize this thread for me',
    ]) {
      expect(needsDeepModel(question), question).toBe(true);
    }
  });

  it('keeps a long lookup on the fast model', () => {
    expect(needsDeepModel('open the file in the left panel and tell me what it says')).toBe(false);
    expect(
      needsDeepModel(
        'open the file in the left panel and tell me what it says about the billing address field',
      ),
    ).toBe(false);
  });

  it('does not treat a word inside another word as a cue', () => {
    expect(needsDeepModel('open the top drawer')).toBe(false);
    expect(needsDeepModel('show me the planet photo')).toBe(false);
  });

  it('ignores empty and whitespace-only transcripts', () => {
    expect(needsDeepModel('')).toBe(false);
    expect(needsDeepModel('   ')).toBe(false);
  });
});

describe('looksLikeATask', () => {
  it('recognizes being told to operate the computer', () => {
    for (const command of [
      'open Spotify and play Lucid Dreams',
      'send this to Josh on Slack',
      'search for cheap flights to Lisbon',
      'sign me up for the newsletter',
      'delete these three files',
      'can you close all these tabs',
      'do this for me',
    ]) {
      expect(looksLikeATask(command), command).toBe(true);
    }
  });

  it('leaves questions about the screen alone, action words and all', () => {
    for (const question of [
      'where is the share button',
      'what should I click here',
      'which of these do I open first',
      'can I send this without a subject line',
      'what does this say',
    ]) {
      expect(looksLikeATask(question), question).toBe(false);
    }
  });
});

describe('looksLikeMediaCommand', () => {
  it('recognizes volume and playback commands', () => {
    for (const command of [
      'turn it up to 25%',
      'turn it down to 5%',
      'turn the music down',
      'set the volume to 30',
      'mute that',
      'pause this',
      'skip this song',
      'play the next track',
      'a bit louder please',
    ]) {
      expect(looksLikeMediaCommand(command), command).toBe(true);
    }
  });

  it('leaves questions and unrelated commands alone', () => {
    for (const transcript of [
      'what song is playing',
      'is the volume too loud on this recording',
      'turn on bluetooth',
      'scroll down a bit',
      'what does this say',
    ]) {
      expect(looksLikeMediaCommand(transcript), transcript).toBe(false);
    }
  });
});

describe('looksLikeMemoryRequest', () => {
  it('recognizes being asked to remember a fact', () => {
    for (const request of [
      'remember that about Sanna',
      'can you remember that for me',
      "don't forget my sister's birthday is in June",
      'keep that in mind next time',
      'memorize this address',
    ]) {
      expect(looksLikeMemoryRequest(request), request).toBe(true);
    }
  });

  it('leaves recall questions and unrelated requests alone', () => {
    for (const transcript of [
      'what do you remember about me',
      'what does this say',
      'turn it down a bit',
    ]) {
      expect(looksLikeMemoryRequest(transcript), transcript).toBe(false);
    }
  });
});

describe('pickModel with a Jev verdict', () => {
  const models = { fast: 'haiku', deep: 'sonnet', canAct: false };

  it('lets a confident verdict overrule the words, either way', () => {
    // The words say lookup; Jev heard a task.
    expect(pickModel('the blue one, add it', models, true)).toBe('sonnet');
    // The words say deep ("why"); Jev heard a plain read-off.
    expect(pickModel('why is the total in red', models, false)).toBe('haiku');
  });

  it('falls back to the words when Jev has no opinion', () => {
    expect(pickModel('why is the total in red', models, null)).toBe('sonnet');
    expect(pickModel('what does this say', models, null)).toBe('haiku');
  });
});

describe('pickModel', () => {
  const models = { fast: 'haiku', deep: 'sonnet', canAct: false };

  it('routes between the two models', () => {
    expect(pickModel('what does this say', models)).toBe('haiku');
    expect(pickModel('why does this say that', models)).toBe('sonnet');
  });

  it('falls back to the deep model when no fast model is configured', () => {
    expect(pickModel('what does this say', { ...models, fast: '' })).toBe('sonnet');
  });

  // Choosing to call propose_task at all is what the fast model gets wrong,
  // so a command has to reach the model that reliably reaches for the tool.
  it('sends commands to the deep model in agent mode', () => {
    expect(pickModel('open Spotify and play Lucid Dreams', { ...models, canAct: true })).toBe(
      'sonnet',
    );
  });

  it('keeps commands on the fast model when agent mode is off', () => {
    expect(pickModel('open the settings and make the window bigger', models)).toBe('haiku');
  });

  // media_control exists in every mode, and handed a volume command the fast
  // model argues from the conversation instead of calling the tool.
  it('sends media commands to the deep model in any mode', () => {
    expect(pickModel('turn it down to 5%', models)).toBe('sonnet');
    expect(pickModel('turn it down to 5%', { ...models, canAct: true })).toBe('sonnet');
  });

  // save_memory exists in every mode too, and the fast model has claimed
  // "saved" without calling it.
  it('sends remember requests to the deep model in any mode', () => {
    expect(pickModel('remember that about Sanna', models)).toBe('sonnet');
    expect(pickModel('remember that about Sanna', { ...models, canAct: true })).toBe('sonnet');
  });
});
