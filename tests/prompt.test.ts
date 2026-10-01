import { describe, expect, it } from 'vitest';
import {
  buildAgentSystemPrompt,
  buildFollowAlongSystemPrompt,
  buildGuideSystemPrompt,
  buildWaitlistSystemPrompt,
  withUsage,
  type GuideContext,
} from '../src/main/ai/prompt';
import { splitSystem } from '../src/main/ai/prompt-cache';

const base: GuideContext = {
  hasExternalTools: false,
  seesScreen: true,
  canProposeTasks: true,
  confirmsPlans: true,
  confirmsActions: true,
  skillNames: [],
  appNote: '',
  disabledTools: [],
};

const prompt = (patch: Partial<GuideContext> = {}): string =>
  buildGuideSystemPrompt({ ...base, ...patch });

// Buddy kept telling people it couldn't control their computer while agent
// mode was on, because the base prompt said so unconditionally — and then,
// once fixed, promised to ask for approval that was switched off. What it
// claims about acting has to follow the settings actually in force.
describe('buildGuideSystemPrompt', () => {
  it('tells Buddy it can act, and how, when agent mode is on', () => {
    expect(prompt()).toContain('propose_task');
    expect(prompt()).toMatch(/can operate this computer/i);
    expect(prompt()).not.toMatch(/cannot operate this computer/i);
  });

  // "Open TextEdit and write a poem" typed the poem into a file picker, then
  // fumbled AppleScript. Opening something first makes it a task.
  it('proposes a task when something has to be opened before typing', () => {
    expect(prompt()).toMatch(/open TextEdit and write a poem.*that is a task/i);
    // "Open Figma and add a circle" opened Figma and ended the turn.
    expect(prompt()).toMatch(/opening an app is never the whole job/i);
    // A correction after a task was answered with pointing and "now I'll click".
    expect(prompt()).toMatch(/fixing it is a task/i);
    expect(prompt({ canProposeTasks: false })).not.toMatch(/open TextEdit and write a poem/i);
  });

  // A real turn ringed the size and the Add to Cart button, then said the
  // item was in the cart. Drawing must never pass for acting, in either mode.
  it('says a drawing does nothing and a result is the only proof of done', () => {
    const on = prompt();
    expect(on).toMatch(/ring around Add to Cart puts nothing in the cart/i);
    expect(on).toMatch(/add-to-cart and checkout included/i);
    expect(on).toMatch(/never report something as done .* unless a tool result/i);
    const off = prompt({ canProposeTasks: false });
    expect(off).toMatch(/never say it is done/i);
    expect(prompt({ seesScreen: false })).not.toMatch(/ring around Add to Cart/i);
  });

  // A local model never gets the drawing tools or propose_task, and reads
  // every prompt character at a few hundred tokens a second.
  it('leaves drawing and agent tasks out of a local prompt', () => {
    const local = prompt({ local: true, canOrder: true });
    expect(local).not.toContain('draw tool');
    expect(local).not.toContain('propose_task');
    expect(local.length).toBeLessThan(prompt().length - 4_000);
  });

  // The commerce positioning is a specialty, not a cage: the prompt must say
  // both that shopping is home turf and that nothing else is refused.
  it('positions Buddy as a commerce agent without restricting it', () => {
    expect(prompt()).toMatch(/commerce agent/i);
    expect(prompt()).toMatch(/never refused/i);
  });

  it('carries the shopper profiles, and only their written categories', () => {
    const empty = { products: [], travel: [], dining: [], formFacts: [], general: [] };
    const shoppers = [
      { ...empty, name: 'Me', products: ['M tops', 'earth tones'], dining: ['no shellfish'] },
      { ...empty, name: 'Sanna (girlfriend)', formFacts: ['Shipping: 1 Main St'] },
      { ...empty, name: 'my brother' }, // no entries: stays out entirely
    ];
    const text = prompt({ shoppers });
    expect(text).toContain('Settings → Memory');
    // The first profile is marked as the user, so "I" statements route to it.
    expect(text).toContain('- Me (the user) — Products: M tops; earth tones. Dining: no shellfish');
    expect(text).toContain('- Sanna (girlfriend) — Form facts: Shipping: 1 Main St');
    expect(text).not.toContain('my brother');
    expect(text).not.toContain('Travel:');
    // Profiles with no entries add nothing.
    const silent = prompt({ shoppers: [{ ...empty, name: 'Me' }] });
    expect(silent).not.toContain('Who the user shops for');
  });

  it('teaches profile-routed saves and the spoken-introduction rule', () => {
    const empty = { products: [], travel: [], dining: [], formFacts: [], general: [] };
    const text = prompt({ shoppers: [{ ...empty, name: 'Zach' }] });
    // The owner's facts are saved as "me" — a real name would split the
    // owner into a second profile when the first is named differently.
    expect(text).toContain('whose profile is the first one (Zach)');
    expect(text).toContain('save those with shopper "me"');
    expect(text).toMatch(/never the owner's real name/i);
    expect(text).toContain('shopper and category');
    expect(text).toMatch(/cannot recognize voices/i);
    expect(text).toMatch(/announces themselves/i);
    // A request or a universal wish ("wants tailored picks") is not a fact
    // about the person; it was landing on new profiles as a memory.
    expect(text).toMatch(/still matter next month/i);
    expect(text).toMatch(/never save it/i);
    // Without profiles the routing still defaults sensibly.
    expect(prompt()).toContain('whose profile is the first one (Me)');
  });

  it('teaches catalog_search only when the catalog key exists', () => {
    expect(prompt({ hasCatalog: true })).toContain('catalog_search');
    expect(prompt()).not.toContain('catalog_search');
  });

  it('teaches product_search only when the Exa key exists, after the catalog', () => {
    const both = prompt({ hasCatalog: true, hasProductSearch: true });
    expect(both).toContain('catalog_search (');
    expect(both.indexOf('catalog_search (')).toBeLessThan(both.indexOf('product_search ('));
    expect(prompt({ hasProductSearch: true })).toContain('product_search');
    expect(prompt()).not.toContain('product_search');
  });

  it('uses a finished agent task\'s links instead of asking for them again', () => {
    for (const text of [prompt(), prompt({ canProposeTasks: false })]) {
      expect(text).toMatch(/work log/i);
      expect(text).toMatch(/never ask the user to paste/i);
    }
  });

  // "The sneakers we discussed" in another thread got "which sneakers?" back.
  it('sends references to other chats through the conversation tools, silently', () => {
    expect(prompt()).toMatch(/list_conversations, then read_conversation/);
    expect(prompt()).toMatch(/never announce the lookup/i);
  });

  it('tells Buddy it cannot act, and where the switch is, when agent mode is off', () => {
    const off = prompt({ canProposeTasks: false });
    expect(off).toMatch(/cannot operate this computer/i);
    expect(off).toMatch(/settings/i);
    expect(off).not.toContain('propose_task');
  });

  it('says exactly one of the two, whatever else is switched on', () => {
    for (const text of [prompt(), prompt({ canProposeTasks: false }), prompt({ hasExternalTools: true })]) {
      const claims = [/\bcan operate this computer/i, /\bcannot operate this computer/i].filter(
        (claim) => claim.test(text),
      );
      expect(claims).toHaveLength(1);
    }
  });

  it('promises plan approval only when plan approval is on', () => {
    expect(prompt({ confirmsPlans: true })).toMatch(/approve the plan before you start/i);
    expect(prompt({ confirmsPlans: false })).not.toMatch(/approve the plan/i);
    expect(prompt({ confirmsPlans: false })).toMatch(/start as soon as you propose/i);
  });

  it('promises a check on consequential actions only when that is on', () => {
    expect(prompt({ confirmsActions: true })).toMatch(/consequential/i);
    expect(prompt({ confirmsActions: false })).not.toMatch(/consequential/i);
  });

  it('describes every combination of the two checkpoints distinctly', () => {
    const wordings = new Set(
      [true, false].flatMap((confirmsPlans) =>
        [true, false].map((confirmsActions) => prompt({ confirmsPlans, confirmsActions })),
      ),
    );
    expect(wordings.size).toBe(4);
  });

  // Search costs one call; the browser costs a window, a bot check and a
  // minute. So a connected search server is the route to the web, and
  // without one Buddy has to say what it's falling back to instead.
  it('makes web search the first move when a server is connected', () => {
    const connected = prompt({ hasExternalTools: true });
    expect(connected).toMatch(/web search tool/i);
    expect(connected).toMatch(/never propose a browser task to look something up/i);
    expect(connected).toMatch(/weather is a web search/i);
  });

  // A real transcript: search found the sweaters, then Buddy proposed an
  // agent task to open them. Opening a found page is one browser_tabs call,
  // in the same turn, not a plan and not a question.
  it('opens found pages with browser_tabs, never a task or a permission ask', () => {
    const connected = prompt({ hasExternalTools: true });
    expect(connected).toMatch(/browser_tabs open in their own browser/i);
    expect(connected).toMatch(/never ask whether they want to see it/i);
    expect(connected).toMatch(/opening pages already found is never that exception/i);
    // With browser_tabs off, the task genuinely is the only route again.
    const noTabs = prompt({ hasExternalTools: true, disabledTools: ['browser_tabs'] });
    expect(noTabs).not.toContain('browser_tabs');
    expect(noTabs).toMatch(/propose_task only once they say yes/i);
  });

  it('follows the Find Products choice for how pages open', () => {
    expect(prompt()).toMatch(/showing finds is one at a time/i);
    expect(prompt()).toMatch(/never ask whether to show them/i);
    expect(prompt({ productBrowse: 'one' })).toMatch(/showing finds is one at a time/i);
    expect(prompt({ productBrowse: 'all' })).toMatch(/showing finds is all at once/i);
    expect(prompt({ productBrowse: 'all' })).not.toMatch(/a second tab in the same turn is refused/i);
    expect(prompt({ productBrowse: 'rundown' })).toMatch(/showing finds is a rundown/i);
    expect(prompt({ productBrowse: 'rundown' })).toMatch(/never ask whether to continue/i);
    expect(prompt({ disabledTools: ['browser_tabs'] })).not.toMatch(/showing finds is/i);
  });

  it('asks for feedback on picks and handles dead links, whatever the pace', () => {
    for (const productBrowse of ['one', 'rundown', 'all'] as const) {
      const text = prompt({ productBrowse });
      expect(text).toMatch(/better suggestions/i);
      expect(text).toMatch(/link is broken, moving on/i);
    }
  });

  it('offers to order a favorite only when a checkout path exists', () => {
    expect(prompt({ canOrder: true })).toMatch(/whether you should order it/i);
    expect(prompt()).toMatch(/never offer to order/i);
    expect(prompt()).not.toMatch(/whether you should order it/i);
  });

  it('never promises to watch, remind, or notify later', () => {
    expect(prompt()).toMatch(/cannot watch a page, check back later, set a reminder, or notify/i);
  });

  it('names the fallback for web questions when no server is connected', () => {
    expect(prompt()).toMatch(/no web search tool is connected/i);
    expect(prompt()).toMatch(/weather app/i);
    expect(prompt({ canProposeTasks: false })).not.toMatch(/weather app/i);
  });

  // Without Bland, Buddy once offered FaceTime — a tool it has never had.
  it('rules out phone and FaceTime when no Bland server is connected', () => {
    const noPhone = prompt();
    expect(noPhone).toMatch(/cannot place phone or FaceTime calls/i);
    expect(noPhone).toMatch(/cannot place calls right now/);
    expect(noPhone).not.toMatch(/Bland/i);
    expect(noPhone).toMatch(/offer a text instead/i);
    expect(prompt({ disabledTools: ['send_message'] })).not.toMatch(/offer a text instead/i);
    const withPhone = prompt({ callStyle: 'Be polite.' });
    expect(withPhone).not.toMatch(/cannot place phone or FaceTime calls/i);
    expect(withPhone).toMatch(/FaceTime is not something you can do/i);
    // A real turn asked "What's her number?" instead of opening Contacts.
    expect(withPhone).toMatch(/find_contact for their number first/);
  });

  it('includes a use-case nudge only when setup is still open', () => {
    expect(prompt({ useCaseNudge: 'Find Products is missing web search.' })).toContain(
      'Find Products is missing web search.',
    );
    expect(prompt()).not.toContain('Find Products is missing');
  });

  it('keeps task results in the work log a later chat can read', () => {
    const agent = buildAgentSystemPrompt('make a spreadsheet', []);
    expect(agent).toMatch(/write results in full/i);
    expect(agent).toMatch(/later chat sees this log/i);
  });

  // A separate browser profile gets challenged by Google. Web tasks use the
  // browser the user already has open, which is already signed in.
  it('does web work in the user\'s own browser', () => {
    const agent = buildAgentSystemPrompt('book a hotel', []);
    expect(agent).toMatch(/user's own browser/i);
    expect(agent).toMatch(/sites already trust it/i);
    expect(agent).not.toMatch(/browser_open/);
    expect(agent).not.toMatch(/duckduckgo/i);
    expect(prompt()).toMatch(/their own browser/i);
    expect(prompt()).toMatch(/if they named one/i);
    expect(prompt()).not.toMatch(/isolated browser/i);
    expect(prompt({ hasExternalTools: true })).toMatch(/the one they named/i);
  });

  it('lists memories and skill names when it has them', () => {
    const me = { name: 'Me', products: [], travel: [], dining: [], formFacts: [], general: ['I live in Portland'] };
    expect(prompt({ shoppers: [me] })).toContain('I live in Portland');
    expect(prompt({ skillNames: ['Y Combinator'] })).toContain('Y Combinator');
    expect(prompt()).not.toContain('Y Combinator');
  });

  // One built-in note rides along when a known app or site is frontmost —
  // and the model is told the screenshot outranks it, since notes describe
  // the usual layout, not this user's window.
  it('injects frontmost app teaching notes only when there are any', () => {
    const withNote = prompt({ appNote: 'Safari:\nReader view: the paragraph icon.' });
    expect(withNote).toContain('Reader view: the paragraph icon.');
    expect(withNote).toMatch(/trust the screenshot over them/i);
    expect(prompt()).not.toMatch(/teaching notes/i);
  });

  // What changes between turns (the front app, this turn's marks) sits
  // after the cache break, so the head before it, and the tools before
  // that, stay cached for the session instead of rewriting on every switch.
  it('keeps the turn-to-turn parts after the cache break and the rules before it', () => {
    const [head, live] = splitSystem(prompt({ appNote: 'Safari notes', canProposeTasks: true, hasMarks: true }));
    expect(head).toMatch(/You are Buddy/);
    expect(head).not.toMatch(/Safari notes|⟦mark N⟧/);
    expect(live).toMatch(/Safari notes/);
    expect(live).toMatch(/⟦mark N⟧/);
    // Nothing volatile means no break at all.
    expect(splitSystem(prompt({ canProposeTasks: false }))[1]).toBe('');
  });

  // With the eyes off Buddy gets no screenshots and no drawing tools, so
  // the prompt must not claim it can see, point, or draw.
  it('stops claiming sight when screen awareness is off', () => {
    const blind = prompt({ seesScreen: false });
    expect(blind).toMatch(/cannot see the screen/i);
    expect(blind).not.toContain('You receive one screenshot');
    expect(blind).not.toContain('draw tool');
    expect(blind).not.toContain('Call point');
    expect(blind).toContain('read_document');
    // And the sighted prompt still has all of it.
    expect(prompt()).toContain('You receive one screenshot');
    expect(prompt()).toContain('draw tool');
  });

  // Contact, message and file asks each cost one native tool call; a
  // proposed agent task for them would be minutes instead of a beat.
  it('routes contact, message and file asks to the one-call tools', () => {
    expect(prompt()).toContain('find_contact');
    expect(prompt()).toContain('search_files');
    expect(prompt()).toContain('reveal_file');
    expect(prompt()).toContain('send_message');
    expect(prompt()).toContain('mail list_inbox');
    expect(prompt({ hasConnectedApps: true, connectedApps: ['gmail'] })).toMatch(
      /when an email account is connected[\s\S]*Never the mail tool for it/,
    );
    expect(prompt()).toContain('notes create');
    expect(prompt()).toContain('run_shortcut');
    expect(prompt()).toContain('run_command');
  });

  // Terminal-shaped work (file cleanup, installs, skill-dictated commands)
  // runs with run_command — in the guide turn for small asks, and inside an
  // agent task instead of driving Finder for big ones.
  it('routes terminal-shaped work to run_command in both modes', () => {
    expect(prompt()).toMatch(/terminal does better[\s\S]*run_command/i);
    expect(prompt({ canProposeTasks: false })).toContain('run_command');
    expect(buildAgentSystemPrompt('clean up the desktop', [])).toMatch(
      /terminal does better[\s\S]*run_command/i,
    );
    expect(prompt()).toContain('browser_tabs');
    expect(prompt()).toContain('now_playing');
    expect(prompt()).toMatch(/never a proposed task/i);
  });

  // A tool disabled in Settings → Tools leaves the registry, so the prompt
  // must stop teaching it — a model told to call a missing tool stalls or lies.
  it('drops the teaching for built-in tools the user disabled', () => {
    const off = prompt({ disabledTools: ['media_control', 'run_command', 'browser_tabs'] });
    expect(off).not.toContain('media_control');
    expect(off).not.toContain('run_command');
    expect(off).not.toContain('browser_tabs');
    expect(off).toContain('find_contact');
    const guideOnly = prompt({ canProposeTasks: false, disabledTools: ['run_command'] });
    expect(guideOnly).not.toContain('run_command');
    const agent = buildAgentSystemPrompt('clean up the desktop', [], 'watch', [], false);
    expect(agent).not.toContain('run_command');
  });

  // The coding tools exist only when a workspace folder is chosen (session
  // marks them disabled otherwise), and their teaching must follow: present
  // with the tools, gone without, and never citing a disabled run_command.
  it('teaches the coding tools only when they exist, in both modes', () => {
    expect(prompt()).toContain('edit_file');
    expect(prompt()).toMatch(/search_code[\s\S]*read_file[\s\S]*edit_file/);
    const off = prompt({ disabledTools: ['list_files', 'read_file', 'search_code', 'edit_file', 'write_file'] });
    expect(off).not.toContain('edit_file');
    // With the terminal off, the coding bullet must not send work to it.
    const noTerminal = prompt({ disabledTools: ['run_command'] });
    expect(noTerminal).toContain('edit_file');
    expect(noTerminal).not.toContain('run_command');
    const agent = buildAgentSystemPrompt('fix the bug', [], 'watch', [], true, '', false, true);
    expect(agent).toContain('edit_file');
    expect(buildAgentSystemPrompt('fix the bug', [])).not.toContain('edit_file');
  });

  // Spoken replies land after the tool already ran, so "I'll search your
  // contacts" narrates the past and reads as stalling. Real transcripts kept
  // opening with it despite a softer version of this rule.
  it('forbids em dashes in every word Buddy writes, in every mode', () => {
    const rule = /never use an em dash/i;
    expect(prompt()).toMatch(rule);
    expect(buildAgentSystemPrompt('book a hotel', [])).toMatch(rule);
    expect(
      buildFollowAlongSystemPrompt({
        goal: 'export a PDF',
        steps: ['Open File'],
        skillNames: [],
        shoppers: [],
        appNote: '',
        canProposeTasks: false,
      }),
    ).toMatch(rule);
  });

  it('forbids announcing tool calls, with the phrases the model actually used', () => {
    expect(prompt()).toMatch(/never announce/i);
    expect(prompt()).toContain("I'll search your contacts");
    expect(prompt()).toContain('Let me look that up');
  });

  // The agent gets the frontmost app's teaching notes too — shortcuts most of
  // all, so a key call replaces scrolling and clicking around the window.
  it('gives the agent the app notes and prefers their shortcuts over mousing', () => {
    const withNote = buildAgentSystemPrompt('play a song', [], 'watch', [], true, 'Spotify:\ncmd-K focuses search');
    expect(withNote).toContain('cmd-K focuses search');
    expect(withNote).toMatch(/teaching notes for the app in front/i);
    expect(buildAgentSystemPrompt('play a song', [])).not.toMatch(/teaching notes for the app in front/i);
    // The standing rule is there with or without a note.
    expect(buildAgentSystemPrompt('play a song', [])).toMatch(/keyboard shortcut beats a mouse journey/i);
  });

  // With a saved card the agent fills checkouts through fill_payment, and the
  // prompt must both teach it and forbid typing card values itself. Without
  // the tool, teaching it would send the model calling something missing.
  it('teaches fill_payment only when the tool exists', () => {
    const withCard = buildAgentSystemPrompt('buy the mug', [], 'watch', [], true, '', false, false, [], true);
    expect(withCard).toContain('fill_payment');
    expect(withCard).toMatch(/never through set_value, type_into, or type/i);
    expect(withCard).toMatch(/payment form is yours, through fill_payment/i);
    expect(withCard).toMatch(/placing the order itself/i);
    const without = buildAgentSystemPrompt('buy the mug', []);
    expect(without).not.toContain('fill_payment');
    expect(without).toMatch(/a payment step is theirs/i);
    expect(without).toMatch(/entering payment details/i);
  });

  // With Jev an element step is one call: the element named in words, no
  // get_window_state first. Without it the prompt must not teach a field
  // the schema does not offer.
  it('teaches naming elements in plain words only when Jev picks them', () => {
    const withJev = buildAgentSystemPrompt('buy the mug', [], 'watch', [], true, '', false, false, [], false, true);
    // The real call shape: an action of the computer tool, never a tool named click_element.
    expect(withJev).toContain('computer {action: "click_element", element: "the Add to cart button"}');
    expect(withJev).not.toMatch(/[^"]click_element \{/);
    expect(withJev).toMatch(/plain-language condition holds/);
    // The ranked "how to act" list must lead with it too, or the model reads refs first and Jev sits idle.
    expect(withJev).toMatch(/2\. Name the element in plain words/);
    expect(withJev).not.toMatch(/2\. Use list_windows and get_window_state/);
    const without = buildAgentSystemPrompt('buy the mug', []);
    expect(without).not.toContain('{element:');
    expect(without).toMatch(/get_window_state, then one element action/);
    expect(without).toMatch(/2\. Use list_windows and get_window_state/);
  });

  it('offers saved skills to the agent only when there are any', () => {
    const withSkills = buildAgentSystemPrompt('file my expenses', [], 'watch', ['Expense Routine']);
    expect(withSkills).toContain('Expense Routine');
    expect(withSkills).toContain('get_skill');
    expect(buildAgentSystemPrompt('file my expenses', [])).not.toContain('get_skill');
  });

  // Without the wall-clock date, "book flights for the 19th" lands in the
  // model's training-cutoff year — a real task searched 2024 and 2025 dates.
  it('tells the model today\'s date, in guide and agent mode alike', () => {
    const today = String(new Date().getFullYear());
    expect(prompt()).toContain(`Today is`);
    expect(prompt()).toContain(today);
    const agent = buildAgentSystemPrompt('book flights', []);
    expect(agent).toContain(`Today is`);
    expect(agent).toContain(today);
  });

  it('teaches walk_me_through only when the walkthrough tools exist', () => {
    expect(prompt({ canWalkThrough: true })).toContain('walk_me_through');
    expect(prompt()).not.toContain('walk_me_through');
  });

  // "Show me how to get from A to B" started a Maps walkthrough. Directions
  // are an answer a connected app can return, so that route comes first.
  it('checks a connected app before a walkthrough or a task', () => {
    const text = prompt({
      canWalkThrough: true,
      hasConnectedApps: true,
      connectedApps: ['google_maps'],
    });
    expect(text).toMatch(/reach for a tool before a walkthrough, a proposed task/i);
    expect(text).toMatch(/directions, places, and distances are Google Maps/i);
    expect(text).toMatch(/not a lesson in using the Maps app/i);
    expect(text.indexOf('Google Maps')).toBeLessThan(text.indexOf('walk_me_through'));
    expect(text).toMatch(/is not a walkthrough: directions/i);
    expect(text).not.toMatch(/"show me how", "guide my hands"/);
    const agent = buildAgentSystemPrompt(
      'get directions',
      [],
      'watch',
      [],
      true,
      '',
      false,
      false,
      ['google_maps'],
    );
    expect(agent).toMatch(/search_apps then use_app/);
    expect(agent.indexOf('search_apps then use_app')).toBeLessThan(agent.indexOf('list_windows'));
    expect(buildAgentSystemPrompt('get directions', [])).not.toMatch(/search_apps then use_app/);
  });

  it('adds the vision-assist teaching when the preset is on', () => {
    expect(prompt({ visionAssist: true })).toMatch(/vision assist is on/i);
    expect(prompt({ visionAssist: true })).toMatch(/prefer spotlight/i);
    expect(prompt()).not.toMatch(/vision assist is on/i);
  });

  // A marked "what is this?" used to draw, think, draw again, then speak:
  // two labels and a spotlight on a stroke the user had already made.
  it('says a mark cannot be seen when eyes are off', () => {
    const blind = prompt({ seesScreen: false, hasMarks: true });
    expect(blind).toMatch(/can't see it because that setting is off/i);
    expect(blind).toMatch(/turn it on/i);
    expect(blind).not.toMatch(/base your answer on what's inside the marks/i);
    expect(prompt({ hasMarks: true })).toMatch(/stay on screen while you answer/i);
  });

  it('answers a marked question in speech, without redrawing the mark', () => {
    const marked = prompt({ hasMarks: true });
    expect(marked).toMatch(/stay on screen while you answer/i);
    expect(marked).toMatch(/do not draw a label, callout, ring, box, or spotlight/i);
    expect(marked).toMatch(/same reply as the answer/i);
    expect(prompt()).not.toMatch(/stay on screen while you answer/i);
    // The name they asked for is spoken. A label on screen was the duplicate.
    expect(prompt()).toMatch(/a name is spoken/i);
    expect(prompt()).toMatch(/same reply as the draw call/i);
    expect(prompt()).not.toMatch(/a name the user asked about/i);
    // An agent task hides the ink and draws again on later steps.
    const agent = buildAgentSystemPrompt('look', [], 'watch', [], true, '', true);
    expect(agent).toMatch(/those marks are how they pointed/i);
    expect(agent).not.toMatch(/stay on screen while you answer/i);
    expect(agent).not.toMatch(/do not call draw again/i);
    expect(buildFollowAlongSystemPrompt({
      goal: 'save',
      steps: ['click save'],
      skillNames: [],
      shoppers: [],
      appNote: '',
      canProposeTasks: false,
    })).not.toMatch(/do not call draw again/i);
  });

  // Rings drawn from screenshot estimates landed far off; an element named in
  // words is found in the window and lands on it, in the one draw call.
  it('has guide mode draw on controls by name, and pick something itself when asked for "something"', () => {
    expect(prompt()).toContain('{"element": "the Reload button"}');
    expect(prompt()).toMatch(/never ask which/i);
    // "I can see the Stuff folder. Let me circle it for you." was spoken before the ring.
    expect(prompt()).toMatch(/never "I can see it", "let me circle it"/i);
    expect(prompt()).toMatch(/unless they ask you to label it/i);
    expect(prompt({ seesScreen: false })).not.toContain('{"element": "the Reload button"}');
    expect(buildAgentSystemPrompt('look', [], 'watch', [], true, '', true)).not.toContain('{"element": "the Reload button"}');
  });

  it('injects the user-editable calling style only when a phone is connected', () => {
    const withPhone = prompt({
      callStyle: 'Never say you are an AI.',
      blandVoice: 'june',
    });
    expect(withPhone).toContain('Never say you are an AI.');
    expect(withPhone).toContain('june');
    expect(withPhone).not.toMatch(/Bland/i);
    expect(withPhone).toMatch(/when a call ends/i);
    expect(withPhone).toMatch(/never leave a placed call unreported/i);
    expect(withPhone).toMatch(/waits until the person who answered says something/i);
    expect(withPhone).toMatch(/starts after a short pause/i);
    expect(withPhone).toMatch(/do not tell the agent to speak the moment the call connects/i);
    expect(prompt()).not.toContain('Never say you are an AI.');
  });
});

// A text from the phone refused to drive the Mac, said there was no card on
// file with one in the keychain, and said Spotify needed a connected app.
// The texting prompt has to carry the same footing as the desktop turn.
// A waitlist account only talks: its own prompt says so, keeps Buddy
// remembering, and never lets the machinery show. Every other plan's
// guide prompt says nothing about a waitlist.
describe('waitlist', () => {
  it('talks, remembers, and says the rest comes after the waitlist', () => {
    const waitlist = buildWaitlistSystemPrompt('Zach');
    expect(waitlist).toMatch(/on the waitlist/i);
    expect(waitlist).toMatch(/cannot look anything up online/i);
    expect(waitlist).toMatch(/save_memory/);
    expect(waitlist).toMatch(/never name the tools, services, or vendors/i);
    expect(buildWaitlistSystemPrompt('Zach', true)).toMatch(/first conversation/i);
    expect(prompt()).not.toMatch(/waitlist/i);
  });

  // Asked how much talking was left, Buddy said there was no daily limit.
  it("knows the plan and today's asks, in the live tail, and never the cents", () => {
    const meters = { talk: { used: 6, limit: 20 }, tasks: { used: 0, limit: 0 }, resetsAt: "2026-09-30T04:00:00.000Z" };
    const system = withUsage(buildWaitlistSystemPrompt("Zach"), { plan: "waitlist", meters });
    const [, live] = splitSystem(system);
    expect(live).toContain("on the waitlist");
    expect(live).toContain("6 of today's 20 asks used, so about 14 left");
    expect(live).toContain("agent tasks aren't included");
    expect(live).toContain("midnight");
    expect(splitSystem(withUsage(prompt(), { plan: "pro", meters: null }))[1]).toContain("Pro plan: unlimited talk");
    expect(withUsage("base", { plan: null, meters: null })).toBe("base");
    expect(live).not.toMatch(/cents|\$\d/);
  });
});

describe('texting prompt', () => {
  const texting = (patch: Partial<GuideContext> = {}): string =>
    prompt({ seesScreen: false, texting: { confirms: true }, ...patch });

  it('proposes tasks, knows the saved card, and treats starting music as a task', () => {
    const text = texting({ hasSavedCard: true });
    expect(text).toContain('propose_task');
    expect(text).toMatch(/open Spotify and play a song/i);
    expect(text).toMatch(/starts when they reply YES/i);
    expect(text).toMatch(/payment card is already saved/i);
    expect(text).toMatch(/starting a particular song.*is a task/i);
    expect(text).not.toMatch(/comes back as parked/i);
  });

  it('starts right away when plans are not confirmed, and asks through the tool when they are', () => {
    expect(texting({ confirmsPlans: false })).toMatch(/task starts right away/i);
    expect(texting()).toMatch(/texts them for a YES, waits for the reply/i);
  });

  it('says so when Computer Use is off, and never mentions the card then', () => {
    const text = texting({ canProposeTasks: false, hasSavedCard: true });
    expect(text).toMatch(/Computer Use is off/i);
    expect(text).not.toContain('propose_task');
    expect(text).not.toMatch(/payment card is already saved/i);
  });
});

describe('buildFollowAlongSystemPrompt', () => {
  it('forbids driving the mouse and requires wait_for_step', () => {
    const text = buildFollowAlongSystemPrompt({
      goal: 'export a PDF',
      steps: ['Open File', 'Click Export'],
      skillNames: [],
      shoppers: [],
      appNote: '',
      canProposeTasks: false,
    });
    expect(text).toMatch(/never click/i);
    expect(text).toContain('wait_for_step');
    expect(text).toContain('export a PDF');
    expect(text).not.toContain('propose_task');
  });

  it('offers propose_task only when agent mode is on', () => {
    const text = buildFollowAlongSystemPrompt({
      goal: 'x',
      steps: ['y'],
      skillNames: [],
      shoppers: [],
      appNote: '',
      canProposeTasks: true,
    });
    expect(text).toContain('propose_task');
  });
});
