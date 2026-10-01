import { describe, expect, it } from 'vitest';
import { APP_SKILLS, matchAppSkill } from '../src/main/ai/app-notes';

const app = (bundleId: string, name = 'App') => ({ name, bundleId });
const match = (a: ReturnType<typeof app> | null, url: string | null) =>
  matchAppSkill(APP_SKILLS, a, url);

describe('matchAppSkill', () => {
  it('matches native apps by bundle id, case-insensitively', () => {
    expect(match(app('com.apple.finder'), null)?.name).toBe('Finder');
    expect(match(app('com.apple.Safari'), null)?.name).toBe('Safari');
    expect(match(app('com.googlecode.iterm2'), null)?.name).toBe('Terminal');
    expect(match(app('com.tinyspeck.slackmacGap'), null)?.name).toBe('Slack');
  });

  it('matches sites by hostname, including subdomains', () => {
    expect(match(null, 'https://github.com/foo/bar')?.name).toBe('GitHub');
    expect(match(null, 'https://www.youtube.com/watch?v=x')?.name).toBe('YouTube');
    expect(match(null, 'https://mail.google.com/mail/u/0/')?.name).toBe('Gmail');
    expect(match(null, 'https://myteam.slack.com/client')?.name).toBe('Slack');
  });

  // In a browser the page is what the user is asking about, so the tab's
  // site skill wins over the browser's own.
  it('prefers the site skill over the browser app skill', () => {
    const chrome = app('com.google.chrome', 'Google Chrome');
    expect(match(chrome, 'https://docs.google.com/document/d/1')?.name).toBe('Google Docs');
    expect(match(chrome, 'https://example.com/')?.name).toBe('Google Chrome');
    expect(match(chrome, null)?.name).toBe('Google Chrome');
  });

  it('returns null for unknown apps, sites, and garbage URLs', () => {
    expect(match(app('com.example.unknown'), null)).toBeNull();
    expect(match(null, 'https://example.com/')).toBeNull();
    expect(match(app('', 'Mystery'), 'not a url')).toBeNull();
    expect(match(null, null)).toBeNull();
  });

  // "notgithub.com" must not match "github.com": only the host itself or a
  // real subdomain counts.
  it('does not match lookalike hostnames', () => {
    expect(match(null, 'https://notgithub.com/')).toBeNull();
    expect(match(null, 'https://github.com.evil.example/')).toBeNull();
  });

  // Disabling an app skill removes it from what the matcher is given, so a
  // disabled skill simply never matches.
  it('matches only within the skills it is given', () => {
    const withoutGitHub = APP_SKILLS.filter((skill) => skill.name !== 'GitHub');
    expect(matchAppSkill(withoutGitHub, null, 'https://github.com/foo')).toBeNull();
  });
});
