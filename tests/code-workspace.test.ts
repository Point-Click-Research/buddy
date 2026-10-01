import { describe, expect, it } from 'vitest';
import {
  applyEdit,
  findProjectRoot,
  resolveInWorkspace,
  secretName,
  writeDenied,
} from '../src/main/code/workspace';

const ROOT = '/Users/dev/project';

// The workspace folder is the coding tools' entire permission boundary, so
// every way of naming a path outside it has to come back as an error, not a
// path — and edits must refuse ambiguous anchors instead of guessing.
describe('resolveInWorkspace', () => {
  it('resolves relative paths against the root', () => {
    expect(resolveInWorkspace(ROOT, 'src/main.ts')).toEqual({
      path: `${ROOT}/src/main.ts`,
      rel: 'src/main.ts',
    });
  });

  it('accepts an absolute path already inside the root', () => {
    expect(resolveInWorkspace(ROOT, `${ROOT}/src/main.ts`)).toMatchObject({ rel: 'src/main.ts' });
  });

  it('refuses traversal out of the root, however it is spelled', () => {
    for (const attempt of ['../secrets.txt', 'src/../../other', '/etc/passwd', `${ROOT}/../other`]) {
      expect(resolveInWorkspace(ROOT, attempt)).toHaveProperty('error');
    }
  });

  it('refuses an empty path and accepts the root itself', () => {
    expect(resolveInWorkspace(ROOT, '  ')).toHaveProperty('error');
    expect(resolveInWorkspace(ROOT, '.')).toEqual({ path: ROOT, rel: '.' });
  });
});

describe('writeDenied', () => {
  it('protects VCS internals and generated folders', () => {
    expect(writeDenied('.git/config')).toMatch(/\.git/);
    expect(writeDenied('node_modules/pkg/index.js')).toMatch(/generated or vendored/);
    expect(writeDenied('src/dist.ts')).toBeNull();
  });

  it('refuses files that look like secrets', () => {
    for (const name of ['.env', '.env.local', 'certs/server.pem', 'keys/deploy.key', '.ssh/id_rsa']) {
      expect(writeDenied(name)).toMatch(/secrets/);
    }
    expect(writeDenied('src/environment.ts')).toBeNull();
  });
});

describe('secretName', () => {
  it('matches credential files, not lookalike source', () => {
    expect(secretName('.env.production')).toBe(true);
    expect(secretName('id_ed25519.pub')).toBe(true);
    expect(secretName('envelope.ts')).toBe(false);
    expect(secretName('keyboard.ts')).toBe(false);
  });
});

// Auto-detection turns the frontmost editor's file into a workspace, so the
// walk must land on the real project root — and never on home or the disk.
describe('findProjectRoot', () => {
  const HOME = '/Users/dev';
  const has = (dirs: Record<string, string[]>) => (dir: string, marker: string) =>
    (dirs[dir] ?? []).includes(marker);

  it('finds the nearest folder with a project marker', () => {
    const markers = has({ '/Users/dev/proj': ['package.json'] });
    expect(findProjectRoot('/Users/dev/proj/src/deep', HOME, markers)).toBe('/Users/dev/proj');
  });

  it('prefers the topmost .git — a monorepo package resolves to the repo', () => {
    const markers = has({
      '/Users/dev/repo': ['.git'],
      '/Users/dev/repo/packages/app': ['package.json'],
    });
    expect(findProjectRoot('/Users/dev/repo/packages/app/src', HOME, markers)).toBe('/Users/dev/repo');
  });

  it('never returns home or above, even when they carry markers', () => {
    const markers = has({ '/Users/dev': ['.git'], '/': ['.git'] });
    expect(findProjectRoot('/Users/dev/notes', HOME, markers)).toBeNull();
    expect(findProjectRoot('/opt/stray', HOME, markers)).toBeNull();
  });

  it('finds a project outside home when it has its own marker', () => {
    const markers = has({ '/opt/tool': ['Cargo.toml'] });
    expect(findProjectRoot('/opt/tool/src', HOME, markers)).toBe('/opt/tool');
  });
});

describe('applyEdit', () => {
  const text = 'const a = 1;\nconst b = 2;\nconst c = 1;\n';

  it('applies a unique exact edit once', () => {
    expect(applyEdit(text, 'const b = 2;', 'const b = 3;')).toEqual({
      text: 'const a = 1;\nconst b = 3;\nconst c = 1;\n',
      count: 1,
    });
  });

  it('refuses a missing anchor with advice to re-read', () => {
    expect(applyEdit(text, 'const d = 4;', 'x')).toMatchObject({
      error: expect.stringContaining('not found'),
    });
  });

  it('refuses an ambiguous anchor with the count', () => {
    expect(applyEdit(text, '= 1;', '= 9;')).toMatchObject({
      error: expect.stringContaining('2 places'),
    });
  });

  it('replaces every occurrence only when replace_all is set', () => {
    expect(applyEdit(text, '= 1;', '= 9;', true)).toEqual({
      text: 'const a = 9;\nconst b = 2;\nconst c = 9;\n',
      count: 2,
    });
  });

  it('refuses empty and no-op edits', () => {
    expect(applyEdit(text, '', 'x')).toHaveProperty('error');
    expect(applyEdit(text, 'const a', 'const a')).toHaveProperty('error');
  });
});
