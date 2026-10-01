// Built-in app skills: teaching notes for common apps and sites — where the
// controls live, the shortcuts worth saying out loud, and what trips people
// up. They sit in Settings → Brain → Skills like any other skill (editable,
// disableable, never deletable), but instead of being loaded by name they
// load themselves: each carries the bundle ids or hostnames it covers, and
// the one matching whatever is frontmost is injected into the guide turn.
// Adapted from OpenClicky's app-skills (MIT).

import type { WritingSkill } from '../../shared/types';
import {
  browserFamily,
  frontmostApp,
  frontmostBrowserUrl,
  type FrontmostApp,
} from '../reader/frontmost';

/** The whole lookup is a bonus; a slow AppleScript must never stall the turn. */
const LOOKUP_TIMEOUT_MS = 3_000;

/** The app skills that ship with Buddy, spread into DEFAULT_SETTINGS.skills. */
export const APP_SKILLS: WritingSkill[] = [
  {
    name: 'Finder',
    builtIn: true,
    apps: ['com.apple.finder'],
    instructions: `Sidebar on the left (Favorites, iCloud, Locations, Tags); toolbar across the top with back/forward at the left, view buttons and the gear action menu in the middle, search at the far right. The path bar, when enabled, runs along the bottom.
- New folder: shift-command-N. Go to a path: shift-command-G. Show hidden files: shift-command-period. Rename: select and press return. Get Info: command-I. Quick Look: space. Views: command-1 through 4 (icons, list, columns, gallery).
- "Where did it save" is usually the matching sidebar item: Downloads, Desktop, Documents.
Gotchas: the toolbar is customizable, so buttons may be missing, the menu bar always works. Deleting from an external disk goes to that disk's own Trash. A greyed sidebar folder is an unmounted disk or an iCloud item still downloading.`,
  },
  {
    name: 'Safari',
    builtIn: true,
    apps: ['com.apple.safari', 'com.apple.safaritechnologypreview'],
    instructions: `One unified toolbar: sidebar button at the far left, back/forward next, the address-and-search field in the center, then share, the new-tab plus, and the tab overview grid at the right. Tabs sit under the toolbar, compact layout puts them inside it.
- Reader view: the small paragraph icon at the left end of the address field, or shift-command-R. Find on page: command-F. Downloads: the arrow near the right end of the toolbar after something downloads, or option-command-L.
- Site settings and extensions live left of the address field; the Develop menu is hidden until Safari Settings, Advanced.
Gotchas: the layout depends on Settings, Tabs (compact vs separate). Private windows have a dark address field, the quickest way to tell them apart.`,
  },
  {
    name: 'Mail',
    builtIn: true,
    apps: ['com.apple.mail'],
    instructions: `Three columns: mailboxes sidebar left, message list middle, the open message right. Toolbar: new message (pencil in a square) at the left, then archive, delete, reply, forward, with search at the right. The unread filter is the small circle icon at the top of the message list.
- New message: command-N. Reply: command-R; reply all: shift-command-R; forward: shift-command-F. Attach: drag the file in, or the paperclip in the compose window.
Gotchas: signatures and compose settings are under Mail Settings, Composing, not in the compose window. Archive and delete behave differently per account (Gmail archive just removes the Inbox label). A hidden sidebar is View, Show Mailbox List (shift-command-M). A message stuck in Outbox means the account is offline.`,
  },
  {
    name: 'Notes',
    builtIn: true,
    apps: ['com.apple.notes'],
    instructions: `Three columns: folders left, notes list middle, editor right. Toolbar above the editor: new note (pencil in a square), format (Aa), checklist, table, media, share, with search at the far right.
- New note: command-N. Checklist: shift-command-L. Styles: the Aa button. The first line typed becomes the note's title automatically. Pin: right-click the note in the list.
Gotchas: notes under "On My Mac" do not sync, the account is the section header in the left column. Locked notes unlock per session. Search matches bodies as well as titles.`,
  },
  {
    name: 'Preview',
    builtIn: true,
    apps: ['com.apple.preview'],
    instructions: `The document fills the window; the sidebar button at the far left of the toolbar shows page thumbnails. The markup toolbar is behind the pen-tip button at the top-right (shift-command-A) and opens as a second row: sketch, shapes, text (the A button), sign (the scribble), adjust.
- Sign a PDF: markup row, signature button, create with trackpad or camera, drag it on. Delete pages: select thumbnails in the sidebar and press delete. Merge PDFs: drag pages from another window into the sidebar. Convert or resize: File, Export and Tools, Adjust Size.
Gotchas: edits autosave into the file. File, Duplicate first to keep the original. Some PDF forms (XFA) show blank and need Adobe Reader.`,
  },
  {
    name: 'System Settings',
    builtIn: true,
    apps: ['com.apple.systempreferences'],
    instructions: `A sidebar lists every section with the search field at its top; the selected pane fills the right side, with a back arrow at the pane's top-left for sub-panes. Privacy & Security sits around the middle of the sidebar list.
- The fastest route to anything is the sidebar search field: type "screen recording", "default browser", "login items".
- Permissions (Screen Recording, Microphone, Accessibility, Automation) are inside Privacy & Security; toggling one usually needs the app relaunched.
Gotchas: Privacy & Security rows only list apps that have already asked, if an app is missing, trigger the request from the app first or use the plus button under the list. On macOS 12 and earlier this app is System Preferences with a different layout; describe positions from the screenshot.`,
  },
  {
    name: 'Terminal',
    builtIn: true,
    apps: ['com.apple.terminal', 'com.googlecode.iterm2'],
    instructions: `The window is one text area; the prompt is the last line, where the cursor sits. Tabs run along the top when more than one is open. iTerm2 can split into panes (command-D vertical, shift-command-D horizontal).
- control-C interrupts the running program; command-C copies. command-K clears. Find in output: command-F. Up-arrow recalls previous commands.
Gotchas: the default shell is zsh (a percent-sign prompt). A blank window with no prompt means a command is still running or waiting for input. The first command that touches Desktop, Documents or Downloads raises a system permission dialog, that dialog is macOS, not the app.`,
  },
  {
    name: 'Google Chrome',
    builtIn: true,
    apps: ['com.google.chrome', 'com.google.chrome.beta', 'com.google.chrome.canary'],
    instructions: `Tabs run along the very top; below them the toolbar: back/forward and reload at the left, the omnibox (address and search) across the middle, then the extensions puzzle piece, the profile avatar, and the three-dot menu at the far right.
- Find on page: command-F. Bookmark: command-D or the star in the omnibox. Incognito: shift-command-N. Reopen a closed tab: shift-command-T. Downloads appear as an icon at the right of the toolbar after a download.
- Site permissions (camera, mic, notifications) are behind the icon at the left end of the omnibox. Settings live in the three-dot menu.
Gotchas: a colored dot on the three-dot menu means an update is waiting. Tab groups collapse into colored pills on the tab strip, clicking the pill expands them.`,
  },
  {
    name: 'Gmail',
    builtIn: true,
    sites: ['mail.google.com'],
    instructions: `The Compose button is at the top-left under the logo; the left sidebar lists Inbox, Sent, Drafts and labels. The search bar spans the top center with the advanced-filter sliders icon at its right end. The settings gear is at the top-right. An open message has reply and forward at its bottom and the archive/delete/label toolbar above it.
- Search operators work in the bar: from:, to:, subject:, has:attachment, is:unread, newer_than:7d. Undo send is the toast at the bottom-left right after sending.
- The compose window opens at the bottom-right; the arrows at its top-right expand it. The paperclip at its bottom attaches files.
Gotchas: single-key shortcuts (C compose, R reply, E archive) only work if enabled in Settings, General. Archive keeps the message in All Mail; Delete is the trash for 30 days.`,
  },
  {
    name: 'Google Calendar',
    builtIn: true,
    sites: ['calendar.google.com'],
    instructions: `The Create button sits at the top-left above the sidebar; the sidebar holds the mini-calendar and the My calendars list. Top bar: Today and the previous/next arrows at the left, the current date range next to them, search (magnifier) and the settings gear at the right, then the view dropdown (Day, Week, Month, Schedule). The grid fills the rest.
- Shortcuts work out of the box: C create event, T today, J/N next period, K/P previous, D/W/M switch view, / search. Clicking an empty slot quick-creates an event; clicking an event opens a preview pop-up with the edit (pencil) and delete (trash) icons at its top.
- The quick-create bubble only takes a title and time: "More options" opens the full editor for guests, location, description and recurrence. Availability reads best in Day or Week view: text in a slot is busy, empty is free; scroll the grid for early morning or late night hours.
Gotchas: changing or deleting an event with guests prompts whether to email them, Send is the safe default unless the user says otherwise. Deleting a recurring event asks "This event", "This and following events" or "All events", match the user's intent, and ask if it is unclear. An "Oops, this overlaps" style conflict is worth surfacing before booking anyway.`,
  },
  {
    name: 'Google Docs',
    builtIn: true,
    sites: ['docs.google.com'],
    instructions: `The title is at the top-left, the menu bar under it, the formatting toolbar below that; the page fills the center. Share is the button at the top-right. Comments live in the right margin; the outline opens via the list icon at the far left edge, level with the page.
- Headings: the style dropdown showing "Normal text" toward the left of the toolbar. Suggesting mode: the pencil dropdown at the far right of the toolbar. Export: File, Download, then PDF or Word. Comment: select text, then command-option-M or the plus in the right margin.
Gotchas: it autosaves. There is no Save command; the cloud icon near the title shows sync. On narrow windows the toolbar collapses into a three-dot overflow at its right end.`,
  },
  {
    name: 'GitHub',
    builtIn: true,
    sites: ['github.com'],
    instructions: `Inside a repository the tab row (Code, Issues, Pull requests, Actions, Settings) sits under the global header. The Code tab has the branch dropdown at the top-left of the file list and the green Code (clone) button at its top-right. A pull request has Conversation, Commits, Checks and Files changed tabs, with the merge box near the bottom of Conversation and reviewers in the right sidebar.
- Review: Files changed tab, click a line's plus to comment, then Review changes at the top-right. Press T in the Code tab to search files; period opens the web editor.
Gotchas: a missing Settings tab or merge button usually means missing permission, not a UI change. A grey merge button means checks are pending or a review is required, hovering it says which.`,
  },
  {
    name: 'Slack',
    builtIn: true,
    apps: ['com.tinyspeck.slackmacgap'],
    sites: ['slack.com'],
    instructions: `The narrow far-left column switches views (Home, DMs, Activity, Later); the sidebar next to it lists channels and DMs. The conversation fills the center with the composer along its bottom; search is at the top center. Threads open as a right-hand panel; the huddle (headphones) button is at the top-right of the channel header.
- Jump anywhere: command-K, then type the channel or person. Reply in thread: hover the message, the speech-bubble icon at its right. Edit your last message: up-arrow in an empty composer.
Gotchas: return sends the message, shift-return is the line break. The far-left column differs per workspace; Home always returns to the channel list.`,
  },
  {
    name: 'Spotify',
    builtIn: true,
    apps: ['com.spotify.client'],
    sites: ['open.spotify.com'],
    instructions: `Your Library is the left sidebar: a long, scrollable list of the user's playlists, artists and albums, a playlist not visible is almost always further down, never missing. The main view fills the center; the Now Playing bar runs along the bottom with play controls in the middle and volume at the right. Global search is the field at the top center.
- To find one of the user's playlists, never scroll the sidebar: the magnifier at the top of Your Library ("Search in Your Library") filters the list as you type. The top search field searches all of Spotify (songs, artists, everyone's playlists), not the user's library.
- Shortcuts: space play/pause; cmd-K focuses search (cmd-L on older builds); cmd-F filters inside an open playlist; cmd-right/cmd-left next/previous track; cmd-up/cmd-down volume; shift-cmd-down mute; cmd-N new playlist; cmd-option-left/right back/forward.
- To play a specific song: key cmd+k, type the song and artist, then read the window and click the top result's row (or press Return for the first match).
Gotchas: in search results, clicking a row or its hover play button starts playback immediately. Click the title text to open a page without playing anything. Space only play/pauses when no text field has focus; a focused search field swallows it. Sidebar filter pills (Playlists, Artists, Albums) hide everything outside the active filter.`,
  },
  {
    name: 'Figma',
    builtIn: true,
    apps: ['com.figma.desktop'],
    sites: ['figma.com'],
    instructions: `The file browser (recents, projects, drafts) opens first; a design file shows the canvas in the center, Layers and pages on the left, and the Design panel (position, W and H, fill) on the right. The tool bar floats at the bottom center of the canvas.
- Tool shortcuts, with the canvas focused: O ellipse, R rectangle, L line, T text, F frame, P pen, V move, K scale. C is Comment, not circle. A circle is O, then a drag with Shift held (or draw, then set W and H equal in the Design panel).
- Drawing: pick the tool, then left_click_drag across empty canvas. The new shape is selected, shows in Layers as "Ellipse 1" or similar, and its W and H appear on the right.
Gotchas: the canvas is drawn, not in the element list, so coordinates are right for it; check the Layers panel or the screenshot for the shape itself before calling it done. A speech-bubble cursor or a comment box means Comment mode: press Esc, then V. Figma saves on its own; there is no Save step.`,
  },
  {
    name: 'YouTube',
    builtIn: true,
    sites: ['youtube.com'],
    instructions: `Search is the bar at the top center. On a watch page the player's controls run along its bottom edge: play and volume at the left; captions (CC), the settings gear, miniplayer, theater and fullscreen at the right. Under the player: the title, the channel row with Subscribe, then like/share/save; the description box below that.
- Playback speed and quality live in the settings gear. Save to a playlist: the Save button in the row under the title. Shortcuts once the player has focus: K pause, J/L skip 10 seconds, C captions, F fullscreen.
Gotchas: the controls hide after a few seconds. Moving the pointer over the video brings them back. Shortcuts need the player focused: one click on the video (two toggles fullscreen).`,
  },
];

/**
 * The one skill matching what is frontmost, or null. A site match beats the
 * browser's own — in a browser, the page is what the user is asking about.
 */
export function matchAppSkill(
  skills: WritingSkill[],
  app: FrontmostApp | null,
  url: string | null,
): WritingSkill | null {
  const hostname = parseHostname(url);
  if (hostname) {
    const site = skills.find((skill) =>
      skill.sites?.some((host) => hostname === host || hostname.endsWith(`.${host}`)),
    );
    if (site) return site;
  }
  const id = app?.bundleId.toLowerCase() ?? '';
  if (!id) return null;
  return skills.find((skill) => skill.apps?.includes(id)) ?? null;
}

/**
 * The formatted note for the frontmost app or tab, from the given (enabled)
 * skills — or '', never an error, and never slower than the timeout. Called
 * once per guide turn.
 */
export async function frontmostAppSkillNote(skills: WritingSkill[]): Promise<string> {
  if (process.platform !== 'darwin') return '';
  const found = await withTimeout(lookup(skills), LOOKUP_TIMEOUT_MS);
  return found ?? '';
}

async function lookup(skills: WritingSkill[]): Promise<string> {
  const app = await frontmostApp();
  if (!app) return '';
  const url = browserFamily(app) ? await frontmostBrowserUrl(app) : null;
  const match = matchAppSkill(skills, app, url);
  return match ? `${match.name}:\n${match.instructions}` : '';
}

function parseHostname(url: string | null): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** Resolves null on timeout or failure; the notes are a bonus, never a wait. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    const settle = (value: T | null): void => {
      clearTimeout(timer);
      resolve(value);
    };
    work.then(settle, () => settle(null));
  });
}
