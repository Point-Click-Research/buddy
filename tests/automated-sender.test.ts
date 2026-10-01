import { describe, expect, it } from 'vitest';
import { isAutomatedSender, senderLabel } from '../src/main/automated-sender';

describe('isAutomatedSender', () => {
  it('flags system addresses, named or bare', () => {
    expect(isAutomatedSender('Google Cloud <CloudPlatform-noreply@google.com>')).toBe(true);
    expect(isAutomatedSender('no-reply@accounts.google.com')).toBe(true);
    expect(isAutomatedSender('GitHub <notifications@github.com>')).toBe(true);
    expect(isAutomatedSender('MAILER-DAEMON@mail.example.com')).toBe(true);
    expect(isAutomatedSender('Chase <alerts.chase@chase.com>')).toBe(true);
  });

  it('leaves people and replyable inboxes alone', () => {
    expect(isAutomatedSender('Sam Lee <sam@example.com>')).toBe(false);
    expect(isAutomatedSender('support@koio.co')).toBe(false);
    expect(isAutomatedSender('Noreen <noreen@example.com>')).toBe(false);
    expect(isAutomatedSender('Some Name')).toBe(false);
  });

  it('tags the inbox line only for automated senders', () => {
    expect(senderLabel('no-reply@x.com')).toBe('no-reply@x.com (automated, no reply)');
    expect(senderLabel('sam@example.com')).toBe('sam@example.com');
  });
});
