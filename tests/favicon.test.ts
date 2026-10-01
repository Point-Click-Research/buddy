import { describe, expect, it } from 'vitest';
import { faviconRequestUrl } from '../src/main/favicon';

describe('favicon request', () => {
  it('asks for a product page when the hostname would return the Google G', () => {
    expect(faviconRequestUrl('mail.google.com')).toContain(
      encodeURIComponent('https://mail.google.com/mail/'),
    );
    expect(faviconRequestUrl('docs.google.com')).toContain(
      encodeURIComponent('https://docs.google.com/document/'),
    );
    expect(faviconRequestUrl('sheets.google.com')).toContain(
      encodeURIComponent('https://docs.google.com/spreadsheets/'),
    );
    expect(faviconRequestUrl('slides.google.com')).toContain(
      encodeURIComponent('https://docs.google.com/presentation/'),
    );
    expect(faviconRequestUrl('drive.google.com')).toContain('domain_url=');
    expect(faviconRequestUrl('calendar.google.com')).toContain('domain_url=');
    expect(faviconRequestUrl('analytics.google.com')).toContain('domain_url=');
  });

  it('uses the Ads product mark, whose favicon is the G on purpose', () => {
    expect(faviconRequestUrl('ads.google.com')).toContain('productlogos/ads/');
  });

  it('looks every other site up by hostname', () => {
    const url = faviconRequestUrl('slack.com');
    expect(url).toContain('domain=slack.com');
    expect(url).not.toContain('domain_url');
  });
});
