// The vocabulary: words Buddy should hear correctly. Each entry's word
// biases speech-to-text toward the right spelling, and an entry that also
// says what Buddy mishears ("Sweetler" for "Sweedler") gets fixed in every
// transcript — a hard guarantee where biasing is only a hint.
//
// Entries are learned from corrected transcripts too: editing "Sweetler" to
// "Sweedler" in the tray panel teaches the whole pair. Pure module, so the
// rules (what counts as a term, how many we keep) can be unit-tested.

import type { VocabularyEntry } from '../../shared/types';
import { unitMatcher } from './pronounce';

const MAX_TERMS = 80;
const MAX_TERM_LEN = 40;
const MIN_TERM_LEN = 2;

const STOPWORDS = new Set(
  (
    'a an the and or but if then so to of in on at for from with as is are was were be been ' +
    'being have has had do does did will would can could should i you he she it we they me my ' +
    'your this that these those not no yes please just that'
  ).split(/\s+/),
);

const TOKEN = /[A-Za-z][A-Za-z0-9''.-]{0,39}/g;

export function tokenize(text: string): string[] {
  return (text.match(TOKEN) ?? []).map((token) => token.replace(/^[.'-]+|[.'-]+$/g, ''));
}

function usable(term: string): boolean {
  if (term.length < MIN_TERM_LEN || term.length > MAX_TERM_LEN) return false;
  return !STOPWORDS.has(term.toLowerCase());
}

/**
 * What a corrected transcript teaches. When the edit kept the word count,
 * each changed position is a mishearing pair (heard → word); otherwise the
 * added words come in as bias-only entries.
 */
export function pairsFromCorrection(original: string, corrected: string): VocabularyEntry[] {
  const from = tokenize(original);
  const to = tokenize(corrected);
  const entries: VocabularyEntry[] = [];

  if (from.length === to.length) {
    for (let i = 0; i < to.length; i++) {
      const word = to[i]!;
      const heard = from[i]!;
      if (word.toLowerCase() === heard.toLowerCase() || !usable(word)) continue;
      entries.push({ word, heard });
    }
    return entries;
  }

  const seen = new Set(from.map((word) => word.toLowerCase()));
  for (const word of to) {
    const key = word.toLowerCase();
    if (seen.has(key) || !usable(word)) continue;
    seen.add(key);
    entries.push({ word, heard: '' });
  }
  return entries;
}

/** Learned entries join the front; one entry per word, newest teaching wins. */
export function mergeVocabulary(
  existing: VocabularyEntry[],
  learned: VocabularyEntry[],
): VocabularyEntry[] {
  const out: VocabularyEntry[] = [];
  const seen = new Set<string>();
  for (const entry of [...learned, ...existing]) {
    const word = entry.word.trim();
    const key = word.toLowerCase();
    if (!usable(word) || seen.has(key)) continue;
    seen.add(key);
    out.push({ word, heard: entry.heard.trim() });
    if (out.length >= MAX_TERMS) break;
  }
  return out;
}

/** The vocabulary's words, for whoever wants to bias recognition toward them. */
export function biasTerms(vocabulary: VocabularyEntry[]): string[] {
  return vocabulary.map((entry) => entry.word);
}

/**
 * Fix a transcript's known mishearings: each entry with a heard form gets
 * that form replaced by the word, whole words only, any casing.
 */
export function applyCorrections(text: string, vocabulary: VocabularyEntry[]): string {
  let result = text;
  for (const entry of vocabulary) {
    const heard = entry.heard.trim();
    if (!heard || !entry.word.trim()) continue;
    result = result.replace(unitMatcher(heard, true), entry.word);
  }
  return result;
}