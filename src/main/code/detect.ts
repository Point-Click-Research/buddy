// Workspace auto-detection: the project of whatever coding window is
// frontmost. The focused file comes from the window's AXDocument (Cursor,
// VS Code, Zed, and Xcode all publish it), and its project root from the
// pure marker walk in workspace.ts. Finding nothing is a quiet null — the
// caller falls back to the fixed folder, or registers no coding tools.

import { existsSync } from 'fs';
import { stat } from 'fs/promises';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { createLogger } from '../log';
import { resolveLocalPath } from '../reader/file';
import { frontmostDocumentPath } from '../reader/frontmost';
import { findProjectRoot } from './workspace';

const log = createLogger('code-detect');

/** The project root of the frontmost window's document, or null. */
export async function detectWorkspaceRoot(): Promise<string | null> {
  if (process.platform !== 'darwin') return null;
  try {
    const raw = await frontmostDocumentPath();
    const path = raw ? resolveLocalPath(raw) : null;
    if (!path) return null;
    const info = await stat(path).catch(() => null);
    if (!info) return null;
    const root = findProjectRoot(info.isDirectory() ? path : dirname(path), homedir(), (dir, marker) =>
      existsSync(join(dir, marker)),
    );
    if (root) log.info(`workspace auto-detected: ${root}`);
    return root;
  } catch {
    // Automation refused or the probe failed: auto-detect simply finds nothing.
    return null;
  }
}
