// Which cloud model answers this question.
//
// Most of what people ask a screen companion is a lookup — "what does this
// say", "where's the share button" — and a frontier model spends a second
// of silence on it for nothing. This decides, from the words alone, whether
// the question needs one. No extra model call, so routing itself is free.
//
// Pure module: the caller supplies the two model names.

/**
 * Cues that the answer has to be worked out rather than read off the
 * screen: reasoning, comparison, diagnosis, or a multi-step explanation.
 */
const DEEP = new RegExp(
  `\\b(?:${[
    'why',
    'how (?:do|does|did|can|could|should|would|to)',
    'explain|teach|walk me|show me how',
    'step by step|steps',
    'compare|versus|vs|difference|differences|better|best|which one',
    'route|directions|navigate|turn by turn',
    'debug|error|broken|failing|troubleshoot|what.s wrong',
    'plan|design|refactor|rewrite|summarise|summarize|analyse|analyze|review|recap',
    'draft|write (?:a |me )?(?:reply|email|message)|type a reply',
    'diagram|sketch|map out|annotate',
  ].join('|')})\\b`,
  'i',
);

/**
 * True when the wording needs the slower model. Length does not: a long
 * lookup ("what's the name of that restaurant on the left") is still a lookup.
 */
export function needsDeepModel(transcript: string): boolean {
  return DEEP.test(transcript);
}

/** Verbs that ask Buddy to operate the computer rather than describe it. */
const ACT = new RegExp(
  `\\b(?:${[
    'open|launch|quit|close',
    'click|press|select|choose|scroll',
    'type|fill|paste',
    'send|email|message|reply|post|share|submit|publish',
    'search for|look up|google|find me',
    'play|pause|skip',
    'buy|order|book|pay|subscribe|checkout',
    'make|create|add',
    'delete|remove|rename|archive|download|install',
    'enable|disable',
    // Separable verbs: "sign me up", "set this up", "turn the volume off".
    '(?:sign|log)(?: me)? (?:in|up|out)',
    'set(?: \\w+)? up',
    'turn(?: \\w+)? (?:on|off)',
    'do (?:this|that|it)',
  ].join('|')})\\b`,
  'i',
);

/**
 * A question about the screen, however many action words it happens to
 * contain — "where's the share button" is not a request to share anything.
 * "can I" asks; "can you" tells.
 */
const ASKING = /^\s*(?:where|what|which|who|when|why|how|is|are|was|does|did|should|can i|could i)\b/i;

/**
 * True when the user is telling Buddy to do something rather than asking
 * about the screen. Only meaningful in agent mode, where the right answer
 * is a propose_task call — and choosing to reach for a tool at all is what
 * the fast model is least reliable at.
 */
export function looksLikeATask(transcript: string): boolean {
  return !ASKING.test(transcript) && ACT.test(transcript);
}

/** Volume and playback commands, which end in a media_control call. */
const MEDIA = new RegExp(
  `\\b(?:${[
    'volume',
    'mute|unmute|louder|quieter',
    // "turn it up", "turn the music down", "turn it down to 5%".
    'turn(?: \\w+){0,2} (?:up|down)',
    'pause|resume|unpause',
    '(?:next|previous|prev|skip(?: this)?|last) (?:song|track)',
    'play|skip this',
  ].join('|')})\\b`,
  'i',
);

/**
 * True when this is a volume or playback command. These end in a tool call
 * whatever mode Buddy is in, and handed to the fast model they fail the same
 * way tasks do — it argues from the conversation instead of acting.
 */
export function looksLikeMediaCommand(transcript: string): boolean {
  return !ASKING.test(transcript) && MEDIA.test(transcript);
}

/** Requests to store a fact for later, which end in a save_memory call. */
const REMEMBER = new RegExp(
  `\\b(?:${[
    'remember',
    'memorize|memorise',
    "don['’]?t forget",
    'keep (?:\\w+ )?in mind',
  ].join('|')})\\b`,
  'i',
);

/**
 * True when the user is asking Buddy to remember something. These end in a
 * save_memory call whatever mode Buddy is in, and handed to the fast model
 * they fail the same way media commands do — it says "saved" without ever
 * calling the tool.
 */
export function looksLikeMemoryRequest(transcript: string): boolean {
  return !ASKING.test(transcript) && REMEMBER.test(transcript);
}

/**
 * Small talk with nothing to look at or do: a hello, thanks, a check-in.
 * These pay for screenshots and every tool schema for a two-word answer, so
 * they go out light. Only the whole utterance counts; "hey, what's this"
 * has a question in it.
 */
const SMALL_TALK = new RegExp(
  `^\\s*(?:(?:hey|hi|hello|yo|sup|howdy|good (?:morning|afternoon|evening)|thanks|thank you|thx|ok|okay|cool|nice|great|awesome|perfect|got it|never ?mind|bye|goodbye|good night|you there|are you there|what'?s up|how are you|how'?s it going|you up),?\\s*(?:buddy|there|man|dude)?[.!?\\s]*)+$`,
  'i',
);

/** True when the words alone say this is small talk. */
export function looksLikeSmallTalk(transcript: string): boolean {
  return SMALL_TALK.test(transcript);
}

export interface Routing {
  /** The quick model. Empty means always use `deep`. */
  fast: string;
  deep: string;
  /** Agent mode is on, so this turn could end in a propose_task call. */
  canAct: boolean;
}

/**
 * The model for this turn. `verdict` is Jev's semantic read of the ask when
 * it had a confident one (see intent.ts); null leaves it to the words.
 */
export function pickModel(transcript: string, routing: Routing, verdict: boolean | null = null): string {
  const deep =
    verdict ??
    (needsDeepModel(transcript) ||
      (routing.canAct && looksLikeATask(transcript)) ||
      looksLikeMediaCommand(transcript) ||
      looksLikeMemoryRequest(transcript));
  return routing.fast && !deep ? routing.fast : routing.deep;
}
