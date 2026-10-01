// The source chip both the overlay and the tray panel show: a site icon plus
// a label that opens the link when clicked. One builder so a source reads and
// behaves the same wherever it appears. Each surface styles the same class
// names to fit its own background.

import { linkHost } from '../../shared/link-text';
import { buildSiteMark, type SiteMarkHost } from './site-mark';

/** The parts of the Buddy API a chip needs, so this stays easy to test. */
export interface SourceChipHost extends SiteMarkHost {
  openExternal(url: string): Promise<boolean>;
}

export function buildSourceChip(buddy: SourceChipHost, url: string, label: string): HTMLElement {
  const host = linkHost(url);
  const chip = document.createElement('button');
  chip.className = 'source';
  chip.title = url; // the full link, for anything the label had to cut

  const text = document.createElement('span');
  text.className = 'source-label';
  text.textContent = label;

  chip.append(buildSiteMark(buddy, host, 'source-mark'), text);
  chip.addEventListener('click', () => void buddy.openExternal(url));
  return chip;
}
