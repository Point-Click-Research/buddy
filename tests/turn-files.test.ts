// Files sent with an ask, staged for the turn so a tool can forward one by
// name, and the shared placement of uploads into an app tool's arguments.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { placeAppFiles, toolkitOf } from '../src/shared/contracts';

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }));

const { clearTurnFiles, localFile, resolveTurnFiles, stageTurnFiles, turnFileNames } = await import(
  '../src/main/session/turn-files'
);

afterEach(clearTurnFiles);

describe('turn files', () => {
  it('writes each file under its own safe name and finds it by the name the user saw', () => {
    const [file] = stageTurnFiles([
      { kind: 'image', name: '../evil/icon.png', mediaType: 'image/jpeg', base64: Buffer.from('hi').toString('base64') },
    ]);
    expect(file!.path.endsWith('1-icon.png')).toBe(true);
    expect(readFileSync(file!.path, 'utf8')).toBe('hi');
    expect(resolveTurnFiles(['ICON.PNG'])).toEqual({ files: [file] });
    expect(turnFileNames()).toEqual(['../evil/icon.png']);
  });

  it('tells the model which files exist when it names one that was never sent', () => {
    stageTurnFiles([{ kind: 'pdf', name: 'lease.pdf', mediaType: 'application/pdf', base64: 'QUJD' }]);
    expect(resolveTurnFiles(['receipt.jpg'])).toEqual({
      error:
        'No file named "receipt.jpg" was sent this turn. The files are: lease.pdf. A file on this Mac is named by its path ("~/Desktop/receipt.jpg").',
    });
    expect(resolveTurnFiles(undefined)).toEqual({ files: [] });
  });

  it('takes a file on this Mac by path, inside home and never a secret', () => {
    const home = mkdtempSync(join(tmpdir(), 'buddy-home-'));
    const dir = join(home, 'Desktop');
    mkdirSync(dir);
    const clip = join(dir, 'clip.mp3');
    writeFileSync(clip, 'audio');
    writeFileSync(join(dir, '.env'), 'x');
    try {
      expect(localFile('~/Desktop/clip.mp3', home)).toEqual({ name: 'clip.mp3', path: realpathSync(clip), mediaType: 'audio/mpeg' });
      expect(localFile(join(dir, '.env'), home)).toEqual({ error: 'That file looks like it holds secrets, which Buddy never sends.' });
      expect(localFile('/etc/hosts', home)).toEqual({ error: 'Buddy only sends files inside your home folder; /etc/hosts is outside it.' });
      expect(localFile(dir, home)).toEqual({ error: `${dir} is a folder, not a file.` });
      expect(localFile('~/nope.txt', home)).toEqual({ error: 'There is no file at ~/nope.txt.' });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('keeps the last files through an ask that sends none, and replaces them when new ones come', () => {
    stageTurnFiles([{ kind: 'image', name: 'icon.png', mediaType: 'image/jpeg', base64: 'QUJD' }]);
    stageTurnFiles([]);
    expect(turnFileNames()).toEqual(['icon.png']);
    stageTurnFiles([{ kind: 'pdf', name: 'lease.pdf', mediaType: 'application/pdf', base64: 'QUJD' }]);
    expect(turnFileNames()).toEqual(['lease.pdf']);
  });

  it('is gone after the turn', () => {
    const [file] = stageTurnFiles([{ kind: 'pdf', name: 'a.pdf', mediaType: 'application/pdf', base64: 'QUJD' }]);
    clearTurnFiles();
    expect(existsSync(file!.path)).toBe(false);
    expect(turnFileNames()).toEqual([]);
  });
});

describe('placeAppFiles', () => {
  const upload = { name: 'lease.pdf', mimetype: 'application/pdf', s3key: 'k1' };

  it('puts the uploads in the file parameter, all of them for a list, the first otherwise', () => {
    const list = { properties: { attachments: { type: 'array', items: {}, file_uploadable: true }, body: {} } };
    expect(placeAppFiles(list, { body: 'hi' }, [upload, upload])).toEqual({ body: 'hi', attachments: [upload, upload] });
    const single = { properties: { attachment: { file_uploadable: true } } };
    expect(placeAppFiles(single, {}, [upload])).toEqual({ attachment: upload });
  });

  it('is null for a tool that takes no file', () => {
    expect(placeAppFiles({ properties: { subject: {} } }, {}, [upload])).toBeNull();
    expect(placeAppFiles(undefined, {}, [upload])).toBeNull();
  });

  it('names the toolkit from the schema, else the slug', () => {
    expect(toolkitOf('GMAIL_SEND_EMAIL')).toBe('gmail');
    expect(toolkitOf('GMAIL_SEND_EMAIL', 'googlemail')).toBe('googlemail');
  });
});
