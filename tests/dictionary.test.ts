import { describe, expect, it } from 'vitest';
import {
  applyCorrections,
  biasTerms,
  mergeVocabulary,
  pairsFromCorrection,
  tokenize,
} from '../src/main/speech/dictionary';

describe('tokenize', () => {
  it('keeps words and drops punctuation', () => {
    expect(tokenize("Hey, that's Kubernetes.")).toEqual(['Hey', "that's", 'Kubernetes']);
  });
});

describe('pairsFromCorrection', () => {
  it('teaches a mishearing pair when a word was swapped', () => {
    expect(pairsFromCorrection('text Sweetler please', 'text Sweedler please')).toEqual([
      { word: 'Sweedler', heard: 'Sweetler' },
    ]);
  });

  it('teaches several swaps at once', () => {
    expect(pairsFromCorrection('call Sana and Sweetler', 'call Sanna and Sweedler')).toEqual([
      { word: 'Sanna', heard: 'Sana' },
      { word: 'Sweedler', heard: 'Sweetler' },
    ]);
  });

  it('falls back to bias-only words when the shape changed', () => {
    expect(pairsFromCorrection('open kubenetes now please', 'open kubernetes please')).toEqual([
      { word: 'kubernetes', heard: '' },
    ]);
  });

  it('skips stopwords and unchanged words', () => {
    expect(pairsFromCorrection('this is a test', 'this is a test')).toEqual([]);
    expect(pairsFromCorrection('send if now', 'send the now')).toEqual([]);
  });
});

describe('mergeVocabulary', () => {
  it('puts learned entries first, one per word, newest teaching wins', () => {
    const existing = [
      { word: 'Sweedler', heard: '' },
      { word: 'Cartesia', heard: '' },
    ];
    const learned = [{ word: 'sweedler', heard: 'Sweetler' }];
    expect(mergeVocabulary(existing, learned)).toEqual([
      { word: 'sweedler', heard: 'Sweetler' },
      { word: 'Cartesia', heard: '' },
    ]);
  });
});

describe('applyCorrections', () => {
  const vocabulary = [
    { word: 'Sweedler', heard: 'Sweetler' },
    { word: 'Sanna', heard: 'Sana' },
    { word: 'Cartesia', heard: '' }, // bias-only: never rewrites
  ];

  it('fixes known mishearings as whole words, any casing', () => {
    expect(applyCorrections('Text sweetler and Sana for me', vocabulary)).toBe(
      'Text Sweedler and Sanna for me',
    );
  });

  it('never rewrites inside other words', () => {
    expect(applyCorrections('The sanatorium is quiet', vocabulary)).toBe(
      'The sanatorium is quiet',
    );
  });
});

describe('biasTerms', () => {
  it('is the vocabulary words', () => {
    expect(biasTerms([{ word: 'Sweedler', heard: 'Sweetler' }])).toEqual(['Sweedler']);
  });
});
