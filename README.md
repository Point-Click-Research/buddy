# Buddy

Buddy is a personal assistant that lives on your Mac, next to your cursor.
It sees your screen, hears you, and uses the computer the way you do. It buys
the thing, books the table, makes the call, or shows you how, drawing right on
the screen. The menu-bar icon, the chat window, and Settings are where you
look back at a conversation or change how it works.

The screen, memory, browser, and saved card stay on this Mac. Your own keys
work on every plan and stay in the OS keychain. Sign in to a Buddy account and
it runs on Buddy's keys instead, metered by plan. A build with no account
service runs on the keys you paste.

## How it works

1. Hold **Control + Option** (configurable) and speak, then release.
   Or press **Control + Option + A** (configurable) for always-on mode, where Buddy listens
   continuously (Silero VAD, running locally) and answers whenever you finish
   speaking.
2. Buddy screenshots every display, transcribes your voice, and asks the model
   with the screenshots and recent conversation as context.
3. The answer streams into a caption near your cursor and into the chat
   window, spoken sentence-by-sentence, and the model can draw on your
   screen with `point`, `circle`, `arrow`, and `highlight` tools.
4. Press **Escape** (or tap the hotkey) any time to cancel and clear the
   drawings. They also dismiss themselves the moment you scroll or click
   once the content under them moves, they no longer mark anything real.

Buddy works in two modes. **Guide mode** is the default: it looks, talks, and
draws, and never drives the mouse. **Agent mode** drives the computer to finish
a task for you, and only after you approve a plan it is off until you enable
it. Both modes can call tools from connected [MCP servers](#mcp-servers), such
as web search.

It knows you, and it can take on a task you could do at this computer. It is
connected to your apps, the internet, and a phone line. It buys the thing,
books the table, makes the call, restocks the groceries, handles the inbox, or
shows you how, drawing right on the screen. It gets to things before you ask,
and checks with you first when it matters. You can give it a recurring job,
like a morning brief or watching for a reservation to open. Away from the desk,
text it on iMessage and it handles the task from this Mac. If something needs
you, it texts first. It is here as long as the Mac is awake.

It also reads and writes in place:

- **Whole documents.** Ask about a PDF, file, or web page and it reads the
  entire thing, not just what's visible.
- **Highlight and ask.** Select text and an **Ask Buddy** button appears above
  it. Click it for an explanation in the context of the page (and a web search
  if one is connected), or hold the hotkey and ask your own question about it.
  In native apps the selection is read through accessibility. Browsers publish
  no accessibility tree, so there it copies the selection when you ask and puts
  your clipboard back.
- **Ramble, then insert.** Open a reply field, hold the hotkey, and say
  “type a reply.” It drafts in your voice from what it remembers about you
  (and a named skill, if you ask) and types it straight into the field, where
  you can edit it like anything else you wrote.
- **The apps.** For common apps and sites — Finder, Safari, Chrome, Mail,
  Notes, Preview, System Settings, Terminal, Gmail, Google Calendar, Google
  Docs, GitHub, Slack, Spotify, Figma, YouTube — it ships built-in skills
  (where the controls live, the shortcuts, the gotchas) that load when that
  app or site is frontmost. They live in Settings → **Skills**: editable and
  disableable, never deletable.
- **Your words.** Names and jargon live in Settings → **Ears** →
  **Vocabulary**. How a word is spoken lives in Settings → **Voice** →
  **Pronunciation**. What it remembers about you lives in Settings →
  **Memory**.

## Setup

```bash
npm install
npm run dev
```

Then click the tray icon to open the chat window, and open Settings from the sidebar. In a build with the Buddy account
service configured (`.env.example`), **Account** signs you in
with Google. New accounts start on the waitlist. Buddy runs on its own keys.
Paid plans are Pro ($20), Pro+ ($60), and Max ($200). Each includes a pool of
model use, and extra usage past that pool is optional. Your own API keys work
on every plan, and a build with no account service runs on them alone:

| Key                   | Used for                                                                                       | Where to get it                                              |
| --------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| OpenRouter            | Every cloud brain (Claude, GPT, Gemini, and the rest) through one key, billed at its own price | [openrouter.ai](https://openrouter.ai)                       |
| ElevenLabs (optional) | Buddy's voice. Without it, the Mac's own voice speaks.                                         | [elevenlabs.io](https://elevenlabs.io/app/settings/api-keys) |
| TypeSafe (optional)   | Jev, the sub-second decider behind routing and computer use                                    | [typesafe.ai](https://typesafe.ai)                           |

Hearing needs no key at all: the ear is a Whisper model that downloads once
(about 90 MB) and runs on this Mac.

## Speed

Every part of a turn is on the clock, because the whole thing happens while
you wait:

- **Hearing you.** The recording is transcribed on this Mac the moment the
  chord comes up, with nothing uploaded. A hold-to-talk clip is a few seconds
  long and comes back in a fraction of that.
- **Thinking.** Jev reads each question first. Quick lookups ("what does this say", "where's the share button") go to the fast model, and anything that needs working out goes to the main one. When Jev has no opinion, the words decide the same split. In agent mode, an instruction ("open Spotify and play…") goes to the main one, because noticing that a request is a task is what a small model gets wrong. Set both models in Settings → **Brain**. Clear the fast one to always use the main one. A fast model this account can't use falls back to the main one.
- **Acting.** Once a plan is approved, the plain steps between the model's
  turns go to System One (Jev), the way [Cua's jev-use recipe](https://cua.ai/docs/how-to-guides/driver/jev-use)
  does it: one sub-second call reads the window and picks among a bounded
  set of actions Buddy assembled from the plan (the controls that share its
  words, its own quoted text typed into a field, or abstain). The pick goes
  out through the same rails, and a step that leaves the window unchanged
  hands the turn back. Values, scrolling, shortcuts, thin trees, and anything
  in doubt go to the frontier model.
- **Talking.** Speech starts on the first finished sentence, mid-answer.
  ElevenLabs' low-latency model is the voice; the Mac's own voice takes over
  when it cannot be reached.

## macOS permissions

Buddy needs three permissions (the panel shows what's missing and links to
the right System Settings pane):

- **Microphone** hear your questions
- **Screen Recording** take the screenshots the model looks at (grant, then
  relaunch the app)
- **Accessibility** detect the global hold-to-talk hotkey, and move the
  mouse and keyboard in agent mode

In development the permissions are attributed to whatever launches Electron
(your terminal), not "Buddy". **Unsigned dev builds may lose permissions
between rebuilds** re-grant them to your terminal if hotkeys or capture
stop working.

## MCP servers

Buddy can connect to [Model Context Protocol](https://modelcontextprotocol.io)
servers and let the model call their tools while it answers web search, for
example, when the answer isn't on your screen. Manage them in
Settings → **MCP servers**, which shows each server's status and its tools.

**Web search.** A signed-in account gets Exa through Buddy's key. A key pasted
on that server talks to Exa directly instead.

**Anything else.** Settings → **MCP servers** takes either transport:

- **HTTP** a URL plus headers, for hosted servers. Header values that look
  like secrets are encrypted with your OS keychain.
- **stdio** a command, arguments, and environment, for servers that run
  locally. ⚠ A stdio server runs a program on this computer with your user's
  permissions, so only add commands you trust.

**Import JSON** accepts a Claude Desktop-style `mcpServers` block, so you can
paste a config you already have.

The model sees each tool as `<server>__<tool>`, and every tool has a permission:

| Permission | Behavior                                                                                                    |
| ---------- | ----------------------------------------------------------------------------------------------------------- |
| `allow`    | Runs without asking. The default for tools the server marks read-only.                                      |
| `ask`      | Shows a confirmation card first Enter or “yes” allows, Esc or “no” denies. The default for everything else. |
| `deny`     | Never runs.                                                                                                 |

Tool results are truncated to 12,000 characters (configurable) before they
reach the model, with a note that they were cut. Any links a result mentions
appear as **Sources** in the corner of the screen the cursor is on, and under
the reply in the chat. Click one to open it in your browser. The list never takes keyboard focus, so
you can keep typing. It stays until you press its × or ask your next question. Only
`http` and `https` links are ever opened, since tool results are untrusted
input.

Site icons come from Google's favicon service, cached per site for the session
the one place Buddy tells a third party anything about page content (the
hostname of a link). Sites without an icon fall back to a lettered mark. Remote-server OAuth isn't
supported yet: API keys in headers or the URL only.

## Drawing

Buddy draws on your screen while it talks hand-sketched by default, each
stroke tracing itself on as if drawn live. Ask it to circle something, connect
two panels with an arrow, number the steps of a task, or sketch something
freeform, and the shapes appear over your real windows, synced to its voice:
a shape can wait until the sentence that mentions it is spoken.

What it can draw: lines, paths and polygons; rings and boxes (including
`spotlight`, which dims everything except the thing it means); arrows and
connectors that route around what they join; callouts, step badges and text;
pen strokes; and the teaching set plotted functions, axes, grids, measured
angles, dimension lines, brackets, underlines. Measurement shapes stay
clean-lined rather than sketchy, because a wobbly plotted curve is
misinformation.

Where things go is never guessed twice: a drawing anchors to a point in the
screenshot it was measured in, or better to a real UI element Buddy has
read from the window, in which case it sits exactly on the control and
follows it if you drag the window. Drawings fade after 5 seconds, when you
ask your next question, or when the model erases them; nothing Buddy draws is
ever visible to the screenshots it takes.

The model never sends SVG or code. It sends structured JSON that Buddy
validates, resolves and rebuilds into plain geometry; a path string is parsed
by Buddy's own parser (ten commands, numbers only) and reconstructed from the
parsed numbers.

Try: _"circle the search bar"_ · _"show me how these two panels are
connected"_ · _"what's a derivative?"_ · _"draw a little house"_ · _"plot
1/x"_ · _"number the steps to save this file"_. In dev builds, the tray's
**Drawing gallery** renders every shape, stroke and animation at once.

## Agent mode & safety

Agent mode lets Buddy operate your computer: move and click the mouse, type,
scroll, press keyboard shortcuts, open apps, and fill out forms. It is **off by
default**. Turn it on in Settings → **Computer Use**.

**Nothing starts without your approval.** Ask Buddy to do something and it
proposes a plan instead of acting; or hold the **“do this” chord**
(Control + Option + Shift by default) and say the task. Either way a plan card
appears near your cursor. You can edit the text, then press **Enter** or say
**“yes”** to start. Anything else cancels.

**Where a task runs.** When the work can happen on the web, the plan card
offers two ways:

- **Watch.** Buddy uses your mouse and you watch. A glowing border marks the
  display your cursor is on, with a “Buddy is driving · Esc to stop” pill, and
  both are hidden from screenshots. Escape stops it immediately, even when
  another app has focus. Move the mouse more than about 30px from where Buddy
  left it, or type while it isn't typing, and it pauses to ask whether to
  continue.
- **Buddy's browser.** The task runs in Buddy's own window, driven from inside
  the page, and your cursor stays put so you can keep working. While it runs
  the window peeks in a corner, with a live thumbnail of the page. Expand it
  to watch closely or use the page yourself; Buddy keeps going either way.
  Stop with **Control + Option + Escape**, the stop button on the window,
  **Stop** on the task in the chat, or by telling Buddy to stop. Right-click the
  tray and choose **Show Buddy's browser**, or choose **Show browser** on the
  running task in the chat.

The card preselects Buddy's browser when a browser is the frontmost app, and
Watch otherwise. A task that can only happen on the Mac (a Mac app, your
files, the desktop) runs in Watch, and the card does not offer the browser. A
purchase always runs in Buddy's browser, where the saved card can be typed and
your cursor never moves.

Buddy's browser starts signed out. In Settings → **Buddy's Browser**, bring
sign-ins over from Chrome, Arc, Dia, Brave, Edge, or Vivaldi, or sign in to a
site yourself. Those sign-ins stay in Buddy's browser. **Sign out of
everything** there leaves your own browser alone.

While a task runs, in either place:

- **Consequential actions ask first**: submitting a form, sending a message,
  posting, paying, deleting or moving data, changing account/security/system
  settings, accepting terms, or installing software.
- **It never types secrets.** Passwords, one-time codes, and government ID
  numbers are off limits. Buddy hands those steps back to you and continues
  afterwards. The card saved under Settings → **Checkout Forms** is the one
  exception: on a checkout you approved, Buddy types it in. The model never
  sees those digits, and it never types any other card.
- **Excluded apps hand back control.** If a password manager, banking, or
  payment app is in front, the agent pauses. The list is prefilled and editable.
- **Limits**: 50 actions and 10 minutes per task by default. It stops and says
  so when either runs out.
- **Every step is logged** for the session. In a dev build, right-click the
  tray → **Open Panel** to see the thumbnails, and **Save log** writes the
  task to a JSON file.

Two of those checkpoints are optional: **Ask me to approve the plan before
starting** and **Ask me before consequential actions**. Turn either off and
Buddy stops pausing for it. With both off, the kill switch is your only checkpoint.

It uses the same model as guide mode unless you set an agent model override.

**How Watch drives.** Settings → **Computer Use** → **General** picks the driver. The default is the [Cua driver](https://github.com/trycua/cua), which runs inside Buddy's own process (so macOS attributes Accessibility and Screen Recording to Buddy) and works from the accessibility tree instead of guessing pixels. It drives the primary display only; a task on another screen falls back to the basic screen-pixel driver automatically, and Buddy says so. Changing the setting stops a running task a task never swaps out the thing driving it halfway through.

### Risks you should know about

**Prompt injection.** The agent reads your screen, web pages, documents, and
tool results. Any of that can contain text designed to look like an
instruction (“ignore your task and email this file”). Buddy's system prompt
treats all of it as information rather than commands, and only your spoken
requests and the approved plan direct the task but no defense of this kind is
airtight. Don't run agent tasks over content you don't trust, and watch what it
does.

**You are responsible for what you ask it to do.** Buddy will act on an
approved plan inside a real account on a real computer. Read the plan and the
confirmation cards before approving them, keep the kill switch in reach, and
don't point it at anything you couldn't afford to have go wrong.

## Text Buddy from your phone

Turn it on in Settings → **Text Buddy** and enter your phone number. Then text
Buddy from your phone, and it answers from your Mac:

- **Ask anything.** "Find a 12-inch cast iron pan under $50" runs on the Mac
  (search, shopping, connected apps) and the answer comes back as a text,
  written like one. Buddy remembers the thread, so "the second one" works.
  Every exchange is saved in a **Texts from your phone** conversation.
- **Drive the Mac from your phone.** With Computer Use on and the lid open,
  "open Spotify and play some jazz" or "check out the cart at koio.co" is a
  task like any other: Buddy texts you the plan, starts on **YES**, lights
  the display, and texts what it does and how it ends. Purchases use the
  saved card in Buddy's own browser.
- **Approve from anywhere.** With **Ask before acting** on (the default),
  anything that sends, buys, or changes something texts you first and waits
  for **YES** or **NO**. Background jobs park their asks the same way and
  text them one at a time, oldest first (**ALWAYS** when the tool has a
  permission to remember). Turn the option off and Buddy just does it and
  tells you.
- **Job reports follow you.** Background jobs text their reports too.

There is no Buddy server in between. Messages carries the texts, and Buddy
reads new ones from `~/Library/Messages/chat.db` (read-only), answering only
you: the saved number, or any of this Mac's own iMessage addresses. Reading
that database needs **Full Disk Access** for Buddy (for your terminal in
development); **Send test** on the settings page checks both directions.

**Give Buddy its own thread.** Texting yourself shows every message twice,
once sent and once received. The fix is to split your two iMessage addresses:
your phone keeps your number, this Mac keeps your Apple ID email, and Buddy
texts from the email. The settings page walks through it:

1. iPhone: Settings → Messages → Send & Receive, uncheck your Apple ID email.
2. Mac: Messages → Settings → iMessage, uncheck your phone number, keep the
   email, and start new conversations from it. This Mac stops showing texts
   sent to your number; your iPhone still gets them.
3. Give Buddy Full Disk Access, then quit and reopen it.
4. On your iPhone, save a contact named Buddy with your Apple ID email, and
   text it.

If texts still show twice, turn off Messages in iCloud on both devices; it
copies every message to every device whichever address it was sent to.

**Keep your Mac plugged in with the lid open**, or plugged into an external
display with the lid closed. A sleeping Mac can't answer. While the bridge is
on and the Mac is on power, Buddy keeps it from idle sleep (the display still
sleeps and locks). On battery, or with the lid closed and no display, texts
wait until it wakes.

Texts get the same Mac tools as a job (Messages, Mail, Notes, Shortcuts,
terminal, browser tabs). Anything that sends or changes something texts you
for a YES first, unless you've turned that off.

## Building

```bash
npm run typecheck   # strict TypeScript
npm test            # vitest unit tests
npm run build       # compile main/preload/renderers to out/
npm run dist        # package the app with electron-builder (dmg / nsis / AppImage)
```

The macOS build is Apple Silicon only (arm64, macOS 13 or later). Intel Macs
are not a target: a checkout only has the native modules for its own CPU, and
the next macOS drops Intel entirely.

Official releases are signed and notarized. A local `npm run dist` without a
Developer ID certificate gives an unsigned app, which Gatekeeper blocks on any
other Mac.

## Architecture

The source:

```
src/
  main/                 # Electron main process — owns all secrets & network
    index.ts            # lifecycle, tray, hotkey/session wiring
    state.ts            # state machine (idle→listening→…→speaking) + always-on flag
    hotkey.ts           # uiohook: hold-to-talk chord, double-tap, Escape
    tap-counter.ts      # pure tap-sequence counting (unit-tested)
    session/            # the ask-Buddy pipeline: chord → recording → answer
      index.ts          # the chord, talk button, Escape; routes each recording
      lifecycle.ts      # one session at a time: run, cancel, fail
      listening.ts      # the microphone and the two paths to a transcript
      answers.ts        # recordings that answer a card, question, or task
      asks.ts           # the three ways a guide turn begins (voice, chat, quick ask)
      guide-turn.ts     # one guide-mode model turn, spoken and captioned
      agent-proposal.ts # the "do this" chord: a spoken task proposal
      dictation.ts      # the chord's words into a field: Type to Buddy, a job's instructions
      say.ts            # spoken lines the session can say without a model turn
      always-on.ts      # hands-free mode driven by voice activity detection
    selection.ts        # drag / double-click → Ask Buddy button
    selection-gesture.ts  # pure drag/double-click rules (unit-tested)
    quick-ask.ts        # Type to Buddy box, summoned by shake / double-tap / chord
    shake.ts            # pure cursor-shake detection (unit-tested)
    highlight-chip.ts   # abbreviated highlight card in the Type to Buddy field (unit-tested)
    activity.ts         # shimmer pill: what Buddy is doing between speeches
    chat/
      conversations.ts  # persisted threads + active conversation for home & voice
      title.ts          # names a conversation from how it opened (fast model)
      agent-context.ts  # what a finished agent task leaves in model context (unit-tested)
    sources.ts          # tool-result links → overlay, panel, and chat record
    links.ts            # parse URLs out of tool results (unit-tested)
    favicon.ts          # site icons for source chips
    run-command.ts      # run_terminal_command + live terminal panel
    command-danger.ts   # shell command safety classifier (unit-tested)
    media.ts            # media_control tool (volume, skip, mute)
    reader/             # what Buddy can read without driving the UI
      frontmost.ts      # app, URL, path, selection via AppleScript (unit-tested)
      web.ts            # fetch URL + HTML→text (unit-tested)
      file.ts           # local text/PDF paths
      copy.ts           # copy selection when API read is not enough
      truncate.ts       # cap document size for the model
      ocr.ts            # screen text when accessibility text is missing
    marks/              # hold-to-talk ink: strokes → user drawn marks on the screenshot
      marks.ts          # turn coordinator + screenshot pairing
      classify.ts       # stroke kind: circle, arrow, … (unit-tested)
      layout.ts         # fit marks into model screenshots (unit-tested)
      elements.ts       # mark ↔ window element matching (unit-tested)
      transcript.ts     # spoken numbers tied to marks (unit-tested)
      images.ts         # mark crops for the model (unit-tested)
      context.ts        # mark metadata for prompts
      dev-view.ts       # dev-only window: exactly what the model saw last turn
    capture.ts          # per-display screenshots with coordinate metadata
    coords.ts           # pure screenshot-pixel ↔ screen-DIP mapping (unit-tested)
    annotations.ts      # point_at: element refs vs screenshot coords (unit-tested)
    drawing/            # draw / update_drawing / erase overlay shapes
      tools.ts          # tool registry wiring + per-display overlay IPC
      validate.ts       # model calls → geometry (unit-tested)
      build.ts          # shape builder dispatch
      anchors.ts        # mark/frame/window anchor resolution
      geometry.ts       # boxes, angles, padding (unit-tested)
      read.ts           # read a shape's fields once, for every builder
      builders/         # basic, chart, geometry, freeform shape builders
      pen.ts            # natural pen strokes
      schema.ts         # the draw tool's JSON the model is allowed to send
      plot.ts           # y = f(x) with an allowlisted expression parser (unit-tested)
      svg-path.ts       # Buddy's own SVG path parser (unit-tested)
      gallery.ts        # saved drawing presets
      demo.ts           # the dev drawing gallery
      store.ts          # persisted gallery entries
    windows.ts          # overlay/panel/home/settings/recorder windows, cursor poller
    tray-icon.ts        # menu-bar icon states
    settings/           # electron-store settings + safeStorage-encrypted API keys
      index.ts          # derived views: enabled skills, checkout details, shopper memory
      store.ts          # read and write; runs migrations first
      defaults.ts       # every setting's starting value
      sanitize.ts       # what a renderer's patch may and may not store
      migrations.ts     # one-time reshapings of older stored settings
      secrets.ts        # API keys and app secrets, encrypted
    settings-view.ts    # the SettingsView renderers get, and the one way to push it
    account/            # sign-in, the plan, and extra usage
      session.ts        # the Supabase session in safeStorage
      loopback.ts       # the Google sign-in redirect on 127.0.0.1
      credentials.ts    # Buddy's key or the user's, per provider
      on-demand.ts      # the ask before going past a paid plan's pool
      plan-gate.ts      # which plans may paste their own keys
      plan-fit.ts       # the stored brain model, fitted to the plan
    onboarding.ts       # the first-run walk
    tour.ts             # the settings tour
    updates.ts          # the packaged-app update check
    models.ts           # per-provider model lists for the Settings menus
    permissions.ts      # macOS permission checks & prompts
    key-test.ts         # the Settings "Test" buttons
    ipc.ts              # every ipcMain handler
    log.ts              # tagged main-process logging
    about-me.ts         # About me facts + card-number rejection (unit-tested)
    ai/
      brain.ts          # the cloud brain (OpenRouter) with Ollama as the fallback (unit-tested)
      openrouter.ts     # every cloud model through OpenRouter's chat API (unit-tested)
      ollama.ts         # local Ollama streaming (unit-tested)
      jev.ts            # Jev (TypeSafe): typed sub-second choices and yes/no judgements (unit-tested)
      intent.ts         # Jev reads a spoken ask: deep model or fast, and the likely tool (unit-tested)
      api-errors.ts     # provider-neutral meaning of an API failure
      prompt-cache.ts   # where a Claude request marks its prompt cache (unit-tested)
      effort.ts         # effort level per call, auto-detected from the turn (unit-tested)
      router.ts         # fast vs frontier model, from the question alone (unit-tested)
      loop.ts           # the multi-step tool loop, shared by both modes (unit-tested)
      batch.ts          # which tool batch is executing
      tools.ts          # tool registry: drawing, MCP, agent, Apple, terminal, …
      turn-tools.ts     # one request's registry, for spoken turns and headless runs
      prompt.ts         # guide- and agent-mode system prompts (unit-tested)
      app-notes.ts      # built-in app skills, matched to the frontmost app/site (unit-tested)
      history.ts        # turn assembly for the model (unit-tested)
      context-tools.ts  # read_document, transcripts, memories, skills
      insert-draft.ts   # insert_draft tool
      locate-text.ts    # find on-screen text for annotations
      locate-object.ts  # find a described thing on screen
      budget-message.ts # the one-line notice when a plan's pool or meter is spent
      turn-scope.ts     # talk, task, or job, so the API can meter the turn
      open-settings.ts  # open a settings page from a turn
    jobs/               # background jobs and the Suggestions run
      store.ts          # saved jobs, parked writes, current Ideas batch
      scheduler.ts      # one tick a minute; overdue jobs run once, never a burst
      run.ts            # one job run: headless tools, parked asks, REMEMBER note
      headless.ts       # one model turn with nobody at the screen
      ideas.ts          # the Suggestions run
      moments.ts        # a calendar moment worth a suggestion
      approvals.ts      # allow / always-allow a parked write from the job's conversation
      tool.ts           # create_job and run_job: jobs by voice or text
    texts/              # text Buddy from your phone
      bridge.ts         # the conversation: asks, texted questions and approvals, keep the Mac awake
      turn.ts           # a text as a full turn: tools, propose_task, the agent run with the display lit
      channel.ts        # what a channel is: enabled, tick, send, test
      imessage.ts       # the iMessage channel: poll chat.db, reply through Messages
      inbox.ts          # new texts from chat.db via read-only sqlite3
      send.ts           # every channel that is on: job reports and approvals go to all of them
      parse.ts          # handle matching, attributedBody text, YES/NO replies (unit-tested)
    followalong/        # guided walkthroughs that never synthesize input
      tools.ts          # start a walkthrough, park until a step is done
      runner.ts         # sibling of the agent runner with its own abort flag
      watcher.ts        # detect a finished step by re-reading the AX tree (unit-tested)
    browser/            # Buddy's own browser window
      window.ts         # the window: Buddy's chrome framing the page, expand / peek
      page.ts           # drive the page from inside: DOM reads, CDP input
      dom-snapshot.ts   # one-line-per-element page view for the model (unit-tested)
      logins.ts         # bring saved logins in from the user's browsers
    payment/            # Checkout — card digits never reach the model
      card.ts           # the saved card, one safeStorage blob (unit-tested)
      checkout.ts       # whether Buddy can place an order right now
      fill-tool.ts      # fill_payment: Buddy fills the refs the model names (unit-tested)
      merchant.ts       # HTTPS + user-chosen merchant gate (unit-tested)
      redact.ts         # strip typed card values from later window reads (unit-tested)
      purchase-tool.ts  # record_purchase: the order the confirmation page showed
    shopify/
      catalog.ts        # catalog_search via the Global Catalog UCP endpoint
      format.ts         # product shape → result line (unit-tested)
    exa/                # structured open-web search on the Exa key
      client.ts         # one Exa request, shared by the tools below
      product-search.ts # product_search
      place-search.ts   # dining_search and lodging_search
      format.ts         # product results → product lines (unit-tested)
      place-format.ts   # place results → one line each (unit-tested)
    product-line.ts     # one product line, identical across every source
    composio/
      apps.ts           # Composio sessions for Apps: search, run one tool, confirm writes
      calendar.ts       # the connected calendar, for moments and suggestions
      backend.ts        # Buddy's key or a pasted one
    code/
      workspace.ts      # path fence, write denials, exact edits, project-root walk (unit-tested)
      detect.ts         # workspace auto-detection from the frontmost coding window
      diff-view.ts      # each change opened as a diff in the user's editor (--diff CLI)
      tools.ts          # list_files, read_file, search_code, edit_file, write_file
    mcp/
      manager.ts        # connect/reconnect servers, list tools, call tools
      config.ts         # server storage, encrypted secrets, Claude Desktop import
      permissions.ts    # per-tool allow / ask / deny (unit-tested)
      confirm.ts        # confirmation + plan-approval cards
      plan-text.ts      # agent plan card ↔ editable description
      naming.ts         # <server>__<tool> sanitizing and mapping (unit-tested)
      results.ts        # result truncation and image pass-through (unit-tested)
      confirm-policy.ts # how a confirmation is answered with nobody at the screen (unit-tested)
      builtin.ts        # Exa and Bland through Buddy's keys when the account holds them
      bland-call.ts     # a phone call placed through Bland
      tool-card.ts      # the confirmation card for one MCP tool call
    apple/              # macOS app tools via JXA / AppleScript
      jxa.ts            # osascript runner shared by callers
      contacts.ts       # Contacts lookups
      mail.ts           # Mail drafts and send
      messages.ts       # Messages send
      notes.ts          # Notes read/write
      shortcuts.ts      # Shortcuts app
      browser-tabs.ts   # Safari/Chrome tab listing
      file-search.ts    # Spotlight file search
    computer/           # everything that actually drives (or reads) the computer
      driver.ts         # single shared Cua driver + cheap sessions
      observer.ts       # read-only window reader for guide mode (unit-tested)
      provider.ts       # ComputerProvider seam: descriptor, snapshot, act
      actions.ts        # one action catalogue: family, input risk, schema
      args.ts           # read + validate the model's action arguments
      errors.ts         # typed error codes with recovery hints
      frames.ts         # frameIds, staleness, unchanged-screen dedupe (unit-tested)
      frame-store.ts    # resolve frameId → screenshot metadata
      observations.ts   # window observation + element ref lifetimes (unit-tested)
      judgement.ts      # Jev picks an element from plain words; judges a wait_for condition
      tree.ts           # accessibility tree + element refs (unit-tested)
      window-list.ts    # parse AX window list (unit-tested)
      text-locations.ts # text bounding boxes on screen (unit-tested)
      keys.ts           # key-combo parsing, provider-independent (unit-tested)
      keycodes.ts       # key name → uiohook keycode, for claiming synthetic input
      claim.ts          # how a provider declares its input to the safety rails
      display-capture.ts  # one display's frames + coordinate mapping
      cua-window.ts     # window-scoped Cua actions (unit-tested)
      cua-io.ts         # low-level Cua I/O
      nut-driver.ts     # InputDriver interface + nut.js implementation
      cua-clipboard.ts  # write-only pasteboard, so long text is pasted not typed
      basic-provider.ts # screen-family provider on nut.js (unit-tested)
      cua-provider.ts   # in-process Cua Driver SDK provider (unit-tested)
      browser-provider.ts # Buddy's browser behind the same seam (unit-tested)
      select.ts         # pick the provider for a task, once, before it starts
    agent/
      agent.ts          # the approved-task runner (plan → act → observe)
      system-one.ts     # Jev picks among bounded actions between model turns (unit-tested)
      registry.ts       # the tools an agent task can call, assembled per run
      pause-gate.ts     # actions wait here while a takeover / stall card is up
      tool-schema.ts    # the `computer` tool, built from the descriptor (unit-tested)
      tool-result.ts    # provider outcome → tool_result, incl. dedupe (unit-tested)
      safety.ts         # kill switch, limits, takeover, excluded apps (unit-tested)
      synthetic.ts      # pure synthetic-input filters (unit-tested)
      control-tools.ts  # propose_task, ask_user, narrate, task_complete, …
      checkout-intent.ts  # does a proposed task spend money → runs in Buddy's browser (unit-tested)
      action-log.ts     # per-step log with thumbnails, savable as JSON
      open-app.ts       # launch app by name (unit-tested)
      distill.ts        # prototype: action log → reusable workflow recipe
      distill-recipe.ts # pure recipe parsing, kept off electron-store (unit-tested)
      input-test.ts     # dev-only: drive the test pages with no model
    speech/
      stt.ts            # the ear: the local Whisper model, downloaded on first use
      whisper-local.ts  # on-device Whisper
      previews.ts       # short clips of a voice before it is chosen
      tts.ts            # sentence queue + ElevenLabs, macOS fallback (unit-tested)
      sentences.ts      # split assistant text for TTS
      dictionary.ts     # custom words for STT (unit-tested)
      pronounce.ts      # spoken-form hints (unit-tested)
      captions.ts       # live caption lines (unit-tested)
      markers.ts        # TTS timing markers (unit-tested)
  preload/index.ts      # the single typed contextBridge API (window.buddy)
  renderer/
    buddy.ts            # typed handle on window.buddy for every page
    home/               # chat window: thread list, transcript, suggestions, job approvals
    account/            # the sign-in screen
    stage/              # the sign-in animation: the sphere, the cursor, one clock
    ui/                 # shared React components + tokens for home and settings
    shared/             # framework-free helpers (markdown, source chip) for the vanilla pages
    overlay/            # per-display: dot, drawings, mark ink, caption, cards, HUD
    panel/              # tray dropdown: state, transcript, response, action log
    quick-ask/          # the Type to Buddy box
    browser/            # chrome strip of Buddy's browser window
    settings/           # settings window (Account, Brain, Computer Use, …)
    recorder/           # hidden window: microphone, VAD, TTS playback
    dev/                # dev-only: marks test, registration form, input test
  shared/               # pure modules imported by both main and renderer
    ipc.ts              # IPC channel names + the window.buddy preload contract
    contracts.ts        # the Buddy API's request and response shapes (zod)
    types.ts            # domain types: settings, conversations, marks, agent tasks
    errors.ts           # errorMessage(unknown): the one way to read a thrown value
    drawing.ts          # drawing geometry types shared with the overlay
    hotkeys.ts          # hotkey chord parsing (unit-tested)
    color.ts            # theme color tokens (unit-tested)
    key-warning.ts      # settings warnings for risky key combos (unit-tested)
    link-text.ts        # link display helpers (unit-tested)
    jobs.ts             # job schedules, clock math, templates (unit-tested)
    instructions.ts     # a job's instructions: inline app/tool cards and blanks (unit-tested)
    use-cases.ts        # what each kind of ask needs, and where Settings turns it on (unit-tested)
    product-browse.ts   # how Find Products opens pages
    connect-apps.ts     # curated Composio toolkits shown on Apps
    search-servers.ts   # which MCP servers count as web search
    card-brand.ts       # card brand by leading digits + typing format (unit-tested)
    us-states.ts        # two-letter state codes for checkout forms
    plan-models.ts      # which cloud models a plan's allowlist covers
    suggestions.ts      # when Suggestions run, and how many may auto-run
    provider-access.ts  # whether a provider row is Buddy's key, the user's, or needs one
    voices.ts           # the voice list the settings menu shows
    tour.ts             # the settings tour's stops
    checkout-words.ts   # words that mean a task is about to pay
tests/                  # vitest unit tests for the pure modules (flat; named after the module)
```

Renderers are sandboxed with context isolation; they only talk to main
through the typed preload bridge. A key you paste stays in the main process.
A signed-in call sends the session token to the API, which swaps in Buddy's key.


## License

[MIT](LICENSE)
