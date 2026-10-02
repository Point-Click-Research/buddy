# Buddy

**The open-source agent you can hand your credit card.**

![License: MIT](https://img.shields.io/badge/license-MIT-black.svg)
![macOS 13+ · Apple Silicon](https://img.shields.io/badge/macOS-13%2B%20·%20Apple%20Silicon-black.svg)
![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-black.svg)
![1,015 unit tests](https://img.shields.io/badge/tests-1%2C015%20passing-black.svg)

Text your Mac from the airport: "buy the espresso machine we looked at,
under $400." Buddy texts back a plan, you reply **YES**, and it checks out in
its own browser on the store's own page, with the card you already have.
The model names the fields; Buddy types the digits; the model, the logs, and
the chat never see them.

Most ways to let an agent pay hand it a credential. Buddy hands it nothing:
no new account, no identity check, no store that has to support anything, and
no server between you and the checkout. It works wherever a checkout page
works, and the model holds nothing worth stealing.

<!-- Demo video goes here. The shot: iPhone in frame texting "buy the
espresso machine from earlier", the plan text arriving with the total, a
YES, then a screen recording of Buddy's browser filling the checkout with
the card fields masked in the transcript panel, then the "ordered" text
landing on the phone. Thirty seconds. -->

```bash
git clone https://github.com/Point-Click-Research/buddy.git && cd buddy
npm install && npm run dev
```

macOS 13+ on Apple Silicon, Node 22+. Grant the three permissions it asks for,
then paste an [OpenRouter](https://openrouter.ai) key or point it at
[Ollama](https://ollama.com) for free. Full steps under
[Quick start](#quick-start). MIT licensed, any model, your keys or none.

## How the card stays out of the model

The card is one encrypted blob under a key in the macOS Keychain, and exactly
one module decrypts it. To pay, the model calls `fill_payment` with element
refs, never values. Five checks run before a digit moves, and each fails
closed:

1. **Fields are what they claim.** Role and label verified against the
   element, not the model's description.
2. **The form hasn't moved.** Re-read before filling.
3. **The merchant and every field's frame are ones you chose.** HTTPS, the
   tab's real URL, a domain you chose (never one the page suggested), and
   each field's frame plus every frame above it on that domain or a listed
   processor (Stripe, Shopify Payments, Adyen, Braintree, PayPal,
   Checkout.com), by the origins the browser reports. A card input in an ad
   frame, or a real Stripe frame an ad placed, is refused by name.
4. **You approve, with the facts from the page.** Card, real host, and order
   total, read by Buddy, never reported by the model. Placing the order is a
   second approval.
5. **Nothing downstream sees the card.** From the first keystroke until the
   task ends, every action result is redacted and screenshots are withheld.

The fill runs only in Buddy's own browser, over CDP, so the card never
touches the clipboard. Where you're already signed in, like Amazon, Buddy
checks out with the payment method saved there and no card is typed at all.

The model also has a terminal and file tools, so the vault is fenced: any
command that reads the Keychain or names Buddy's data folder is refused
before a confirmation card is shown, and the coding tools and document
reader skip the folder. That's a backstop. The real wall is the Keychain's
own prompt, and it asks you: if a dialog mid-task says some process wants
**Buddy Safe Storage**, deny it. Buddy never needs that approval.

The code is `src/main/payment/`, six files, unit-tested. The full argument
and threat model are in
[docs/secrets-by-reference.md](docs/secrets-by-reference.md).

**Prior work.** 1Password's
[Secure Agentic Autofill](https://1password.com/blog/closing-the-credential-risk-gap-for-browser-use-ai-agents)
set the shape for passwords: the agent asks, you approve, the credential is
injected without the model holding it. [Agentcard's Vault](https://www.agentcard.sh)
did it for payments: the agent types a dummy number, the request to the
processor is intercepted, you approve on your phone, and the real card is
swapped in. It's a service for companies that build agents, with a map of
each processor behind it. Buddy does the swap on your Mac, into the form
itself, with no server and no map.

### Against the other ways an agent pays

|                          | **Buddy**                                      | Virtual card issuers                | Network tokens                           | Card vaults                                   |
| ------------------------ | ---------------------------------------------- | ----------------------------------- | ---------------------------------------- | --------------------------------------------- |
| **What the agent holds** | Element refs, never a number                   | A full card number, CVC, and expiry | A token                                  | A dummy number that spends nothing            |
| **What you set up**      | Save a card in Settings                        | An issuer account and a funding card | Enrollment with the network or wallet   | A card in the agent company's app, with a passkey |
| **What the store needs** | A checkout page                                | To accept cards                     | An agentic-payments integration          | A processor the vault has mapped              |
| **Per-purchase cap**     | The approval shows the total; a hard cap is next | Yes, the card's amount             | Yes, in the token's scope                | Approval per purchase, or a threshold you set |
| **What the store sees**  | Your real card                                 | A one-time number                   | A token                                  | Your real card                                |
| **Who you pay**          | Nobody, for the payment                        | The issuer                          | The network or wallet, through enrollment | The vault vendor, past its free tier         |

_Patterns, not products, as of October 2026. Open an issue if we've got one
wrong._

A virtual card is better at one thing: limiting the blast radius if the
agent spends wrong, because the number is capped and disposable. Until
Buddy's own cap ships, the approval text is where you catch a bad total.
Everything else cuts the other way: a virtual card is still a number the
agent holds, a token works only where the merchant has integrated, and a
vault puts a company's server and processor map between you and the checkout.

## Two systems, not one big model

Most computer-use agents send every micro-decision to a frontier model. Has
the page finished loading? Which of these forty buttons is "Add to cart"? Did
the click land? Each answer costs seconds and money, and the model answers
from a screenshot, so it guesses at coordinates and sometimes clicks the
lookalike.

Buddy splits the work the way people do:

- **System Two, the frontier model,** plans, reasons, and turns what you
  asked into a plan you approve.
- **System One, [Jev](https://typesafe.ai),** makes the bounded calls inside
  the loop in well under a second: which element a step means, whether a
  window has reached the state a task is waiting on, whether you finished the
  step you were shown, what kind of ask just came in. Every question has a
  fixed set of answers with "none of these" among them, and an unsure answer
  hands the turn back instead of acting.

Both systems work from the **accessibility tree** through the
[Cua](https://github.com/trycua/cua) driver, not from guesses at a
screenshot. An element ref is the real control, with its role and label, and
a stale one is refused or re-bound by its description.

**About Jev.** It's a hosted model from TypeSafe, a separate company, and it
needs the network. It's optional: without a TypeSafe key, in Airplane Mode,
or whenever a call fails or comes back unsure, every call site falls back to
the behavior it had before Jev existed, which is asking the frontier model.
You lose seconds per step, not capability. We use it because nothing we've
found running locally answers "which of these refs is the Add to cart
button" in under a second with calibrated confidence. If that changes, it's
one file (`src/main/ai/jev.ts`) behind one interface.

Is it finished? No. macOS is a long tail of apps with thin accessibility
trees, custom controls, and windows that move under you, and plenty of steps
still fall back to the frontier model or to pixels. But this is the shape we
think holds up, and all of it is here to read, fork, and make better.

## Quick start

Requirements: macOS 13 or later on Apple Silicon, Node 22 or later.

```bash
npm install
npm run dev
```

Click the menu-bar icon to open the chat window, then open Settings from the
sidebar. Grant **Microphone**, **Screen Recording**, and **Accessibility** when
asked (in development they're attributed to your terminal).

Then give it a brain, one of three ways:

- **Your own keys**, under Settings → Developer → **API keys**:

  | Key                   | Used for                                                                                       | Where to get it                                              |
  | --------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
  | OpenRouter            | Every cloud brain (Claude, GPT, Gemini, and the rest) through one key, billed at its own price | [openrouter.ai](https://openrouter.ai)                       |
  | ElevenLabs (optional) | Buddy's voice. Without it, the Mac's own voice speaks.                                         | [elevenlabs.io](https://elevenlabs.io/app/settings/api-keys) |
  | TypeSafe (optional)   | Jev, the sub-second decider behind routing and computer use                                    | [typesafe.ai](https://typesafe.ai)                           |
  | Composio (optional)   | Apps: Gmail, Calendar, Slack, Notion, GitHub, and the rest                                     | [composio.dev](https://composio.dev)                         |

- **Local models**, free: install [Ollama](https://ollama.com) and download a
  model under Settings → Developer → API keys → **Local**. See
  [Offline, on a laptop](#offline-on-a-laptop) for what runs locally.
- **A Buddy account**, no keys at all: the builds from the website sign in
  with Google and run on Buddy's keys, metered by plan. A build from this
  repo has no account service. Your own keys still take over whenever you
  paste them.

Hearing needs no key: the ear is a Whisper model that downloads once (about
90 MB) and runs on this Mac.

Things to try: _"circle the search bar"_ · _"what's a derivative?"_ · _"plot
1/x"_ · _"number the steps to save this file"_ · _"find a 12-inch cast iron pan
under $50"_ · hold **Control + Option + Shift** and say _"open Spotify and play
some jazz"_.

## What else it does

Everything below runs through the same loop: a model turn, tools behind an
allow / ask / deny table, and a YES before anything spends, sends, or deletes.

- **Drives your Mac.** Agent mode clicks, types, scrolls, opens apps, and
  fills forms through the accessibility tree. Watch it on your screen, or
  send it to **Buddy's browser**, its own window with sign-ins brought over
  from Chrome, Arc, Dia, Brave, Edge, or Vivaldi, so your cursor stays put.
- **Runs errands end to end.** Shopping, dining, and lodging search; checkout
  with your saved card; phone calls placed through Bland; Mail, Messages,
  Notes, Contacts, Shortcuts, Spotlight, and the terminal.
- **Works in your apps.** Gmail, Google Calendar, Slack, Notion, GitHub,
  Linear, Drive, and 35 more in a click under Settings → **Apps**, through
  [Composio](https://composio.dev); any other Composio toolkit connects by
  slug. Buddy drafts and triages mail, posts to Slack, files the Linear
  issue, and reads the doc, asking before anything sends.
- **Runs jobs on a schedule.** "Reorder paper towels every month", "tell me
  when this drops under $200." Every 15 minutes up to monthly, with nobody at
  the screen. Each run carries a note to the next, so "tell me when it drops"
  knows the last price. Anything that would send, buy, or change something
  waits for your OK, in the app or by text.
- **Suggests what to do next.** Once or twice a day it reads your calendar,
  inbox headers, open tabs, and recent conversations and offers a few
  specific things to take on. The run can look but never act. Tap one, or let
  it run the safe ones (a search, a draft) on its own.
- **Sees, hears, talks, draws.** Hold **Control + Option** and speak. Buddy
  screenshots every display, transcribes on-device with Whisper, and answers
  into a caption by your cursor, spoken sentence by sentence, drawing on the
  screen as it goes: rings, boxes, spotlights, arrows that route around what
  they join, step badges, plotted functions. Circle something while you hold
  the chord and "move this one over here" just works.
- **Shows you how.** Guide mode looks, talks, and draws but never touches the
  mouse. It walks you through a task one step at a time, noticing each step
  land as you do it.
- **Reads and writes in place.** A PDF, file, or web page gets read whole,
  not just what's on screen. Highlight text for an **Ask Buddy** button. Say
  "type a reply" and it drafts in your voice into the open field. Point it at
  your editor and it reads, searches, and edits the project, each change as a
  diff.
- **Writes its own skills.** After an agent task, Buddy distills the run into
  a recipe: the task as a template, what must already be true, the shortest
  route that worked, and how to check it's done. Save it and the next similar
  task goes straight there.
- **Runs offline.** Local models through Ollama, tuned for a laptop. Flip on
  **Airplane Mode** and nothing leaves the Mac. See
  [Offline, on a laptop](#offline-on-a-laptop).

## How Buddy compares

The agents of 2026 split into camps. **Gateway agents** like
[OpenClaw](https://openclaw.ai) and
[Hermes Agent](https://hermes-agent.nousresearch.com) run headless on a box
you never look at and answer you from a chat app. **Hosted assistants** like
Instinct run your errands on a computer of their own. **Voice assistants**
like [HeyClicky](https://www.heyclicky.com) and
[VoiceOS](https://www.voiceos.com) sit on your desktop and listen, as closed
services processed in their own cloud. **Lab desktop agents** from Anthropic,
OpenAI, Meta, and Perplexity are tied to their own models.

Buddy is the one that runs on the Mac you already use, in code you can read.

|                            | **Buddy**                                                      | OpenClaw              | Hermes Agent                | Instinct                  | HeyClicky                        | VoiceOS                            |
| -------------------------- | -------------------------------------------------------------- | --------------------- | --------------------------- | ------------------------- | -------------------------------- | ---------------------------------- |
| **Where the work happens** | Your Mac: your apps, your screen, a browser with your sign-ins | The gateway's machine | Wherever it runs            | Instinct's cloud computer | Your Mac, processed in its cloud | Your Mac or PC                     |
| **Doing the work**         | Accessibility tree via Cua, plus its own browser over CDP      | Browser and shell     | Browser and terminal        | Its cloud computer's apps | Background agents                | 175 actions across 21 integrations |
| **Models**                 | Any via OpenRouter, or local via Ollama, fully offline         | Any                   | Any                         | Instinct's                | Its own, in its cloud            | Its cloud                          |
| **Cost**                   | Free with your keys or local models; hosted plans optional     | Free                  | Free; optional subscription | Invite-only               | Free tier; $20 and $100 plans    | Trial; Pro from $11.99/mo          |
| **Source**                 | MIT                                                            | MIT                   | MIT                         | Closed                    | Closed                           | Closed                             |

None of the other five documents how it pays for things with your money,
which is the row we care most about and the one described above.

_As of October 2026, from each project's own docs and press coverage. Spot
something out of date? Open an issue._

**Where each one shines.** Pick **OpenClaw** if you want one community-owned
agent behind every chat app you use, on a server that never sleeps. Pick
**Hermes Agent** if you want a Python agent that runs headless anywhere, grows
its own skills, and lives in your terminal and editor. Pick **Instinct** if
you'd rather run nothing at all and text an assistant that has its own
computer. Pick **HeyClicky** if you want a zero-setup buddy by your cursor
and don't need to see or change the code. Pick **VoiceOS** if dictation is
most of what you want, on Mac or Windows. Pick **Buddy** if you want the
agent on the Mac you already use, driving your real apps, answering from your
own Messages, and buying with your own card without the model ever seeing it.

**The lab agents.** Claude with Cowork, ChatGPT Work, Muse for Mac, and
Perplexity Personal Computer are strong desktop agents. They're closed, and
each one runs its own vendor's models. Buddy runs any model, including one on
your laptop, and you can read every line of the harness.

## Under the hood

Buddy is a TypeScript Electron app with a strict main/renderer split. If you
build agents, this is the part you came for.

- **Jev in every loop.** Each decision is one sub-second call over a bounded
  set of options, and an answer below the confidence bar is never acted on.
  - _Intent._ Before a brain is chosen, Jev reads the ask: does it need the
    deep model, which tool will it likely end in, is it a task to propose.
    Quick lookups land on the fast model and save seconds.
  - _Elements._ A step can name its target in plain words ("the Add to cart
    button") and Jev binds it to a ref, so the model acts in one call instead
    of reading the window and then choosing. The same question re-binds a
    stale ref.
  - _Waiting._ `wait_for` polls the window and Jev judges a plain-language
    condition ("the order has been placed") each time, with no model turn per
    poll.
  - _System One._ Once a plan is approved, the plain steps between frontier
    turns go to Jev, after
    [Cua's jev-use recipe](https://cua.ai/docs/how-to-guides/driver/jev-use).
    A step that leaves the window unchanged hands the turn back.
  - _Walkthroughs._ Jev decides when you've finished the step Buddy showed
    you.
- **One computer seam, three drivers.** Every action goes through a single
  `ComputerProvider` interface: the in-process Cua driver (accessibility tree
  and element refs), a pixel driver on nut.js, and Buddy's browser driven from
  inside the page over CDP. A task picks its driver once and never swaps it
  halfway through.
- **It knows its input from yours.** Synthetic input is claimed before it's
  sent, so the safety rails can tell Buddy's clicks from yours. Move the mouse
  about 30px or type while it isn't, and the task pauses to ask. Excluded apps
  (password managers, banking) hand control back. Hard limits default to 50
  actions and 10 minutes.
- **A card the model can use but never read.** Covered under
  [How the card stays out of the model](#how-the-card-stays-out-of-the-model).
  Two details that section leaves out: the card is filled only in Buddy's
  browser, through the page's own text input, so it never touches the system
  clipboard; and About me refuses anything that scans as a card number.
- **An iMessage bridge with nothing in the middle.** Buddy reads `chat.db`
  read-only through the system `sqlite3`, decodes the archived
  `attributedBody` that recent macOS keeps message text in, and replies
  through Messages. It answers only your number or this Mac's own addresses,
  skips its own echoes, and starts from the newest row, so an old text is
  never answered. Every confirmation card a tool would show becomes a text
  that waits for an exact **YES**, **NO**, or **ALWAYS** ("yes but make it
  Tuesday" is a new ask, not a yes). iPhone photos arrive as images, and on
  power the Mac stays awake to answer. Channels sit behind one small
  interface, so a second one is one more file.
- **Thousands of app tools, none of them in the prompt.** GitHub alone is
  hundreds of tools, and loading every toolkit's schemas would drown any model.
  With Composio, the model never sees a toolkit schema: it searches for the
  tool it needs, and Buddy runs that one. Composio tools share MCP's
  allow / ask / deny table, so one permission model covers everything.
  Writes that lose nothing (a Gmail draft, a label, archive, trash) run like
  reads; sending and deleting for good still ask.
- **Skills distilled from the action log.** A finished run of three or more
  actions goes to the fast model with its log, and comes back as a recipe or
  the single word `UNRELIABLE` when the route was too erratic to trust. Refs,
  coordinates, and observation ids are banned from the recipe, since none
  survive to the next run; retries and dead ends fold into the step that
  finally worked. A recipe a saved skill already covers is never offered, and
  distillation never costs the finished task anything.
- **Jobs that behave like a cron you'd trust.** One tick a minute runs
  what's due. Waking from sleep catches up with one run, never a burst, and a
  failed run retries shortly instead of waiting a whole slot. Jobs that only
  call APIs run a few at a time; a job that needs the Mac itself (terminal,
  tabs, Messages) waits for an idle moment and runs alone.
- **Headless turns that wait for you.** Jobs and texts run as full model turns
  with nobody at the screen. Writes park as approvals in the job's
  conversation or go to your phone as a YES/NO.
- **Drawings are data, not code.** The model never emits SVG. It sends
  structured JSON that Buddy validates and rebuilds into geometry. Every shape
  anchors to a point in the screenshot it was measured in, or to a real UI
  element, and none of it shows up in Buddy's own screenshots.
- **MCP, first class.** HTTP or stdio servers, Claude Desktop config import,
  secrets in the keychain, and a per-tool allow / ask / deny permission.
- **Tested like it matters.** 1,015 unit tests across 99 files, over pure
  modules: coordinate mapping, Jev's decisions, the shell command danger
  classifier, card redaction, plan text, scheduling, and more.

## Offline, on a laptop

Most agents treat local models as an afterthought: point the harness at
Ollama and hope. Buddy shapes every request for a 4B to 30B model running
on the Mac in front of you.

- **Built around Ollama's one cache.** Ollama reuses only the start of the
  last prompt it read. Buddy keeps the system prompt and tools at the front,
  byte for byte the same every turn, and moves the live context (the front
  app, its notes) onto the latest ask, so a turn re-reads your words, not
  every tool.
- **Warm before you ask.** At launch, and whenever settings or tools change,
  Buddy reads the prompt and tools into the cache, even while you're still
  talking, and skips it when they're already there. The model stays loaded
  for 30 minutes. The first question doesn't pay a minute-long cold
  read.
- **Context sized to your RAM.** Ollama drops the front of a prompt that
  overflows, which is where the instructions live. Buddy asks for 16k tokens
  on a 16 GB Mac and 32k on 32 GB or more.
- **Less to read.** Tool descriptions are cut to their first sentence, tool
  results to about 1,500 tokens, and schemas that small models reliably mangle
  (drawing, task proposals) are left out. Reasoning models are asked to think
  briefly, and the recommended Qwen builds are the instruct tags, not the ones
  that think for hundreds of tokens before every reply.
- **Graceful when the model can't see.** A text-only model that refuses
  screenshots gets the same request again without them, with a note that it
  can't see the screen, instead of a failed turn.
- **No terminal.** Install Ollama and download a recommended model (picked by
  RAM, from 8 GB to 32 GB) in Settings. Whisper runs inside Buddy on ONNX.

**Airplane Mode** is one switch with a preflight checklist (ears, brain,
voice) that shows what's ready and links to whatever isn't. With it on, Buddy
itself sends nothing over the internet: Whisper hears you, Ollama answers,
the macOS voice speaks, and remote MCP servers pause while stdio and
localhost ones keep working. Offline, Buddy answers questions about your
screen and uses local tools. Drawing, agent tasks, and Jev need the cloud,
so they sit it out.

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

- **Microphone**: hear your questions
- **Screen Recording**: take the screenshots the model looks at (grant, then
  relaunch the app)
- **Accessibility**: detect the global hold-to-talk hotkey, and move the
  mouse and keyboard in agent mode

In development the permissions are attributed to whatever launches Electron
(your terminal), not "Buddy". **Unsigned dev builds may lose permissions
between rebuilds**, so re-grant them to your terminal if hotkeys or capture
stop working.

## MCP servers

Buddy can connect to [Model Context Protocol](https://modelcontextprotocol.io)
servers and let the model call their tools while it answers: web search, for
example, when the answer isn't on your screen. Manage them in
Settings → **MCP servers**, which shows each server's status and its tools.

**Web search and phone calls.** A signed-in account gets Exa and Bland through
Buddy's keys. Without an account, add them from **Recommended** on that page
with your own [Exa](https://dashboard.exa.ai) and [Bland](https://app.bland.ai)
keys. A pasted key talks to the service directly.

**Anything else.** Settings → **MCP servers** takes either transport:

- **HTTP**: a URL plus headers, for hosted servers. Header values that look
  like secrets are encrypted with your OS keychain.
- **stdio**: a command, arguments, and environment, for servers that run
  locally. ⚠ A stdio server runs a program on this computer with your user's
  permissions, so only add commands you trust.

**Import JSON** accepts a Claude Desktop-style `mcpServers` block, so you can
paste a config you already have.

The model sees each tool as `<server>__<tool>`, and every tool has a permission:

| Permission | Behavior                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------ |
| `allow`    | Runs without asking. The default for tools the server marks read-only.                                       |
| `ask`      | Shows a confirmation card first. Enter or “yes” allows, Esc or “no” denies. The default for everything else. |
| `deny`     | Never runs.                                                                                                  |

Tool results are truncated to 12,000 characters (configurable) before they
reach the model, with a note that they were cut. Any links a result mentions
appear as **Sources** in the corner of the screen the cursor is on, and under
the reply in the chat. Click one to open it in your browser. The list never takes keyboard focus, so
you can keep typing. It stays until you press its × or ask your next question. Only
`http` and `https` links are ever opened, since tool results are untrusted
input.

Site icons come from Google's favicon service, cached per site for the session.
That is the one place Buddy tells a third party anything about page content (the
hostname of a link). Sites without an icon fall back to a lettered mark. Remote-server OAuth isn't
supported yet: API keys in headers or the URL only.

## Drawing

Buddy draws on your screen while it talks, hand-sketched by default, each
stroke tracing itself on as if drawn live. Ask it to circle something, connect
two panels with an arrow, number the steps of a task, or sketch something
freeform, and the shapes appear over whatever is on screen, Buddy's own chat
window included, so a typed question gets drawn on too. When Buddy is
speaking, a shape can wait until the sentence that mentions it is spoken.

What it can draw: lines, paths and polygons; rings and boxes (including
`spotlight`, which dims everything except the thing it means); arrows and
connectors that route around what they join; callouts, step badges and text;
pen strokes; and the teaching set: plotted functions, axes, grids, measured
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
  exception: on a checkout you approved, in Buddy's own browser, Buddy types
  it in. The model never sees those digits, and it never types any other
  card.
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

**How Watch drives.** Settings → **Computer Use** → **General** picks the driver. The default is the [Cua driver](https://github.com/trycua/cua), which runs inside Buddy's own process (so macOS attributes Accessibility and Screen Recording to Buddy) and works from the accessibility tree instead of guessing pixels. It drives the primary display only; a task on another screen falls back to the basic screen-pixel driver automatically, and Buddy says so. Changing the setting stops a running task; a task never swaps out the thing driving it halfway through.

### Risks you should know about

**Prompt injection.** The agent reads your screen, web pages, documents, and
tool results. Any of that can contain text designed to look like an
instruction (“ignore your task and email this file”). Buddy's system prompt
treats all of it as information rather than commands, and only your spoken
requests and the approved plan direct the task, but no defense of this kind is
airtight. Don't run agent tasks over content you don't trust, and watch what it
does.

**You are responsible for what you ask it to do.** Buddy will act on an
approved plan inside a real account on a real computer. Read the plan and the
confirmation cards before approving them, keep the kill switch in reach, and
don't point it at anything you couldn't afford to have go wrong.

## Text Buddy from your phone

You text your own Mac from anywhere, and it does the job on its own screen
while you're out. Turn it on in Settings → **Text Buddy** and enter your phone number. Then text
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

A TypeScript Electron app with a strict main/renderer split. The main
process owns all secrets and network; renderers are sandboxed and reach it
only through one typed preload bridge, so a key you paste never leaves main.
Every action on the computer goes through a single `ComputerProvider` seam
with three drivers behind it (accessibility tree, pixels, Buddy's browser),
and logic that can be pure lives in a pure module with a unit test.

The full source tree, one line per file, is in
[ARCHITECTURE.md](ARCHITECTURE.md).

## Contributing

Issues and pull requests are welcome. Before opening one:

```bash
npm run typecheck
npm test
```

A few house rules keep the codebase small enough to hold in your head: one
purpose per file, logic that can be pure goes in a pure module with a unit
test in `tests/`, and shared UI comes from `src/renderer/ui` rather than being
rebuilt.

## License

[MIT](LICENSE)
