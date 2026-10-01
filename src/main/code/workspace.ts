// The pure rules of the coding workspace: which paths the coding tools may
// touch, which they must never write, and how an exact-string edit applies.
// Everything here is path-and-string logic with no fs, so it is unit-tested;
// tools.ts owns the actual reads and writes.

import { dirname, isAbsolute, normalize, relative, resolve, sep } from 'path';

/** Registry names the coding workspace registers; Settings → Tools switches them as one. */
export const CODING_TOOL_NAMES = [
  'list_files',
  'read_file',
  'search_code',
  'edit_file',
  'write_file',
] as const;

/** Directories no listing or search descends into: generated, vendored, or huge. */
export const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.venv',
  'venv',
  '__pycache__',
  'target',
  'vendor',
  'Pods',
  'DerivedData',
]);

/** Files whose presence marks a directory as a project root. */
export const PROJECT_MARKERS = [
  '.git',
  'package.json',
  'pnpm-workspace.yaml',
  'Cargo.toml',
  'go.mod',
  'pyproject.toml',
  'requirements.txt',
  'Gemfile',
  'Package.swift',
  'pom.xml',
  'build.gradle',
  'CMakeLists.txt',
];

/**
 * The project root for a file, walking up from its folder toward home. A
 * repository root is authoritative, so the topmost directory holding .git
 * wins (a monorepo package resolves to the whole repo); without one, the
 * nearest directory holding any other marker does. Home itself and anything
 * above it are never a workspace — that boundary is what keeps auto-detection
 * from quietly widening the fence to the whole disk.
 */
export function findProjectRoot(
  startDir: string,
  home: string,
  hasMarker: (dir: string, marker: string) => boolean,
): string | null {
  let gitTop: string | null = null;
  let nearestOther: string | null = null;
  for (let dir = normalize(startDir); dir !== home && dirname(dir) !== dir; dir = dirname(dir)) {
    if (hasMarker(dir, '.git')) gitTop = dir;
    else if (!nearestOther && PROJECT_MARKERS.some((marker) => marker !== '.git' && hasMarker(dir, marker))) {
      nearestOther = dir;
    }
  }
  return gitTop ?? nearestOther;
}

/**
 * Resolve a requested path against the workspace root, refusing anything
 * that lands outside it. Relative paths resolve from the root; an absolute
 * path is fine only when it is already inside. The error strings name the
 * rule, so the model can correct itself instead of retrying blind.
 */
export function resolveInWorkspace(
  root: string,
  requested: string,
): { path: string; rel: string } | { error: string } {
  const raw = requested.trim();
  if (!raw) return { error: 'A path is required.' };
  const path = normalize(isAbsolute(raw) ? raw : resolve(root, raw));
  const rel = relative(root, path);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return { error: `That path is outside the coding workspace (${root}); only paths inside it are allowed.` };
  }
  return { path, rel: rel || '.' };
}

/**
 * Why a workspace-relative path must not be written, or null when it may.
 * Secrets are refused in both directions by the caller; the write-only rules
 * here protect state that is not the user's source (VCS internals, vendored
 * dependencies).
 */
export function writeDenied(rel: string): string | null {
  const parts = rel.split(sep);
  if (parts.includes('.git')) return 'Never write inside .git; use run_command for git operations.';
  if (parts.some((part) => SKIP_DIRS.has(part))) {
    return 'That path is inside a generated or vendored directory; edit the source instead.';
  }
  if (secretName(parts[parts.length - 1]!)) {
    return 'That file looks like it holds secrets, which the coding tools never touch.';
  }
  return null;
}

/** Files that hold credentials: refused for reading and writing both. */
export function secretName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower === '.env' ||
    lower.startsWith('.env.') ||
    lower.endsWith('.pem') ||
    lower.endsWith('.key') ||
    lower.startsWith('id_rsa') ||
    lower.startsWith('id_ed25519')
  );
}

/**
 * Apply one exact-string edit: old must appear exactly once (or replace_all
 * must be set), so an ambiguous anchor is refused with the count instead of
 * silently changing the wrong place.
 */
export function applyEdit(
  text: string,
  oldString: string,
  newString: string,
  replaceAll = false,
): { text: string; count: number } | { error: string } {
  if (!oldString) return { error: 'old_string must not be empty; to create a file, use write_file.' };
  if (oldString === newString) return { error: 'old_string and new_string are identical — nothing to change.' };
  const count = text.split(oldString).length - 1;
  if (count === 0) {
    return { error: 'old_string was not found in the file. Re-read the file and copy the text exactly, including whitespace.' };
  }
  if (count > 1 && !replaceAll) {
    return { error: `old_string matches ${count} places. Include more surrounding lines to make it unique, or set replace_all.` };
  }
  return { text: text.split(oldString).join(newString), count: replaceAll ? count : 1 };
}
