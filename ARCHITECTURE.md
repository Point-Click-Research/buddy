# Architecture

Buddy is a TypeScript Electron app with a strict main/renderer split: the
main process owns every secret and every network call, renderers are
sandboxed with context isolation and talk to main only through the typed
preload bridge. This is the source tree, one line per file, with what each
one is for.

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
      attachments.ts    # files sent with a chat message → content blocks + transcript chips (unit-tested)
      turn-files.ts     # files a tool may forward: staged for the turn, or fenced home-folder paths (unit-tested)
    dictation-target.ts # which window's field is taking dictation
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
    vault-fence.ts      # Buddy's own data folder, refused to every tool that reads files (unit-tested)
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
      types.ts          # drawing limits per call and the shape of a stored drawing
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
      config.ts         # the API and Supabase project, baked in at build time
      session.ts        # the Supabase session in safeStorage
      api.ts            # calls to the Buddy API as the signed-in user; /v1/me cached on disk
      loopback.ts       # the Google sign-in redirect on 127.0.0.1
      local.ts          # chats, suggestions, and the first-run walk, per account
      personal.ts       # memory, checkout, skills, and the thinking model, per account
      personal-split.ts # who pre-account settings belong to on first separation (unit-tested)
      scope.ts          # whether a pre-account chat belongs to the signed-in account (unit-tested)
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
    app-icon.ts         # a Mac app's icon from its bundle, for settings that name an app
    automated-sender.ts # no-reply / notification addresses nobody replies to (unit-tested)
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
      files.ts          # texted photos and PDFs → the same drafts the chat composer sends
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
      merchant.ts       # HTTPS + user-chosen merchant gate; frame-origin gate per field (unit-tested)
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
      distill.ts        # action log → reusable workflow recipe, offered as a skill
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
    boogle/             # the browser's start page: Buddy's search bar before a page is open
    settings/           # settings window (Account, Brain, Computer Use, …)
    recorder/           # hidden window: microphone, VAD, TTS playback
    public/vad/         # VAD worklet + ONNX runtime, copied in by scripts/copy-vad-assets.mjs
    dev/                # dev-only: marks test, registration form, input test
  shared/               # pure modules imported by both main and renderer
    ipc.ts              # IPC channel names + the window.buddy preload contract
    contracts.ts        # the Buddy API's request and response shapes (zod)
    types.ts            # domain types: settings, conversations, marks, agent tasks
    errors.ts           # errorMessage(unknown): the one way to read a thrown value
    drawing.ts          # drawing geometry types shared with the overlay
    pen.ts              # one perfect-freehand pen for the user's marks and Buddy's drawings
    attachments.ts      # files sent with a chat message: kinds, limits, draft and chip shapes (unit-tested)
    hotkeys.ts          # hotkey chord parsing (unit-tested)
    color.ts            # theme color tokens (unit-tested)
    key-warning.ts      # settings warnings for risky key combos (unit-tested)
    link-text.ts        # link display helpers (unit-tested)
    jobs.ts             # job schedules, clock math, templates (unit-tested)
    instructions.ts     # a job's instructions: inline app/tool cards and blanks (unit-tested)
    use-cases.ts        # what each kind of ask needs, and where Settings turns it on (unit-tested)
    product-browse.ts   # how Find Products opens pages
    connect-apps.ts     # featured Composio toolkits shown first on Apps
    search-servers.ts   # which MCP servers count as web search
    card-brand.ts       # card brand by leading digits + typing format (unit-tested)
    us-states.ts        # two-letter state codes for checkout forms
    plan-models.ts      # which cloud models a plan's allowlist covers (unit-tested)
    suggestions.ts      # when Suggestions run, and how many may auto-run
    moments.ts          # calendar / clock / mail signals → a one-word question, offered once (unit-tested)
    occasions.ts        # US dates people plan around, for suggestions runs (unit-tested)
    greeting.ts         # time-of-day hellos on screen and by text (unit-tested)
    em-dash.ts          # Buddy never shows or sends an em dash
    site.ts             # Buddy's public domain and contact addresses
    provider-access.ts  # whether a provider row is Buddy's key, the user's, or needs one
    voices.ts           # the voice list the settings menu shows
    tour.ts             # the settings tour's stops
    checkout-words.ts   # words that mean a task is about to pay
tests/                  # vitest unit tests for the pure modules (flat; named after the module)
  fixtures/             # recorded AX window lists and states the tree / window-list / cua-window tests read
scripts/                # build helpers: VAD asset copy, UI preview, browser and schema probes
```

Renderers are sandboxed with context isolation; they only talk to main
through the typed preload bridge. A key you paste stays in the main process.
A signed-in call sends the session token to the API, which swaps in Buddy's key.
