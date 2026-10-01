import { describe, expect, it } from 'vitest';
import { namesFenced, spellings } from '../src/main/vault-fence';

const DATA = '/Users/z/Library/Application Support/Buddy';

describe('spellings', () => {
  it('spells a home-relative folder the three ways a shell might', () => {
    expect(spellings(DATA, '/Users/z')).toEqual([
      DATA,
      '~/Library/Application Support/Buddy',
      '$HOME/Library/Application Support/Buddy',
    ]);
  });

  it('leaves a folder outside home as it is', () => {
    expect(spellings('/Library/Buddy', '/Users/z')).toEqual(['/Library/Buddy']);
  });
});

describe('namesFenced', () => {
  const fenced = spellings(DATA, '/Users/z');

  it('matches the folder through escapes, quotes, case, and ${HOME}', () => {
    expect(namesFenced('cat ~/Library/Application\\ Support/Buddy/config.json', fenced)).toBe(true);
    expect(namesFenced('cat "$HOME/Library/Application Support/Buddy/config.json"', fenced)).toBe(true);
    expect(namesFenced("cat '${HOME}/Library/Application Support/Buddy/config.json'", fenced)).toBe(true);
    expect(namesFenced('open /users/z/library/application support/buddy', fenced)).toBe(true);
  });

  it('leaves neighbours and unrelated paths alone', () => {
    expect(namesFenced('ls ~/Library/Application\\ Support/BuddyOther', fenced)).toBe(false);
    expect(namesFenced('ls ~/Library/Application\\ Support/Buddy', fenced)).toBe(true);
    expect(namesFenced('ls ~/Library/Application\\ Support/Buddy; echo done', fenced)).toBe(true);
    expect(namesFenced('ls ~/Library/Application\\ Support/Code', fenced)).toBe(false);
    expect(namesFenced('/Users/z/project/src/index.ts', fenced)).toBe(false);
    expect(namesFenced('anything', [])).toBe(false);
  });
});
