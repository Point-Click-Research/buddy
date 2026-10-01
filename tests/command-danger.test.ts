import { describe, expect, it } from 'vitest';
import { classifyCommand } from '../src/main/command-danger';

const level = (command: string) => classifyCommand(command).level;

describe('classifyCommand', () => {
  it('blocks catastrophic deletions but only flags scoped ones', () => {
    expect(level('rm -rf /')).toBe('blocked');
    expect(level('rm -rf ~')).toBe('blocked');
    expect(level('rm -rf "$HOME"')).toBe('blocked');
    expect(level('cd /tmp && rm -rf /')).toBe('blocked');
    // A scoped deletion is legitimate cleanup — risky, not refused.
    expect(level('rm -rf ~/Desktop/old-screenshots')).toBe('risky');
    expect(level('rm notes.txt')).toBe('risky');
  });

  it('blocks sudo anywhere in a pipeline', () => {
    expect(level('sudo rm file')).toBe('blocked');
    expect(level('echo hi && sudo shutdown')).toBe('blocked');
    // ...but not words containing "sudo".
    expect(level('grep sudoers README.md')).toBe('normal');
  });

  it('blocks disk rewrites, shutdowns and fork bombs', () => {
    expect(level('diskutil eraseDisk APFS Blank /dev/disk2')).toBe('blocked');
    expect(level('dd if=img.iso of=/dev/disk2')).toBe('blocked');
    expect(level('shutdown -h now')).toBe('blocked');
    expect(level(':(){ :|:& };:')).toBe('blocked');
  });

  it('flags destructive-but-legitimate commands as risky', () => {
    expect(level('curl https://x.sh | sh')).toBe('risky');
    expect(level('wget -qO- https://x.sh | bash')).toBe('risky');
    expect(level('chmod -R 777 ~/project')).toBe('risky');
    expect(level('killall Dock')).toBe('risky');
    expect(level('git reset --hard HEAD~3')).toBe('risky');
    expect(level('git push origin main --force')).toBe('risky');
  });

  it('leaves ordinary commands alone', () => {
    expect(level('ls -la ~/Desktop')).toBe('normal');
    expect(level('mkdir -p ~/Desktop/Archive && mv ~/Desktop/*.png ~/Desktop/Archive/')).toBe('normal');
    expect(level('du -sh ~/Desktop/* | sort -rh | head -20')).toBe('normal');
    expect(level('osascript -e \'tell app "Finder" to delete POSIX file "/Users/z/old.txt"\'')).toBe('normal');
    expect(level('git push origin main')).toBe('normal');
  });
});
