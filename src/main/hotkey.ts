// Global input listening via uiohook: hold-to-talk chord detection,
// double-tap of Control, Escape, and the scrolls/clicks that mean the screen
// under Buddy's drawings is changing. Needs macOS accessibility permission.
// Electron's globalShortcut has no key-up event, hence uiohook.
//
// A chord is any combination the user recorded in Settings: one or more
// modifiers, optionally with one ordinary key ("Control+Alt",
// "Control+Alt+Space"). See src/shared/hotkeys.ts for the model.

import { app, systemPreferences } from "electron";
import { UiohookKey, uIOhook, type UiohookKeyboardEvent } from "uiohook-napi";
import { parseChord, type ChordModifier } from "../shared/hotkeys";
import { uiohookCodeFor } from "./computer/keycodes";
import { createLogger } from "./log";
import { createTapCounter } from "./tap-counter";

const log = createLogger("hotkey");

// Left/right variants for each chord modifier name used in settings.
const MODIFIER_CODES: Record<ChordModifier, number[]> = {
  Control: [UiohookKey.Ctrl, UiohookKey.CtrlRight],
  Alt: [UiohookKey.Alt, UiohookKey.AltRight],
  Shift: [UiohookKey.Shift, UiohookKey.ShiftRight],
  Meta: [UiohookKey.Meta, UiohookKey.MetaRight],
};

// The OS-reported modifier flag for each name. A chord is only satisfied
// when its own modifiers are down and no other is — holding Cmd must not
// turn a Cmd+Ctrl+Alt shortcut into a Ctrl+Alt chord.
const MODIFIER_FLAGS: Record<
  ChordModifier,
  (e: UiohookKeyboardEvent) => boolean
> = {
  Control: (e) => e.ctrlKey,
  Alt: (e) => e.altKey,
  Shift: (e) => e.shiftKey,
  Meta: (e) => e.metaKey,
};

const CONTROL_CODES = new Set(MODIFIER_CODES["Control"]);
const MODIFIER_KEYCODES = new Set(Object.values(MODIFIER_CODES).flat());

export interface HotkeyCallbacks {
  /** Current chord from settings, e.g. "Control+Alt" (read per event, so changes apply live). */
  getChord(): string;
  onChordDown(): void;
  onChordUp(heldMs: number): void;
  /** Another key was pressed while the chord was held: it's a normal shortcut. */
  onChordCancel(): void;
  /** The "do this" agent chord, e.g. "Control+Alt+Shift". */
  getAgentChord(): string;
  onAgentChordDown(): void;
  onAgentChordUp(heldMs: number): void;
  onAgentChordCancel(): void;
  /** The always-on toggle chord ('' = none); fires once on press. */
  getAlwaysOnChord(): string;
  onAlwaysOnChord(): void;
  /** The Type to Buddy chord ('' = none); fires once on press. */
  getQuickAskChord(): string;
  onQuickAskChord(): void;
  /** Double-tap of Control summons the Type to Buddy box when this is on. */
  isDoubleTapArmed(): boolean;
  onDoubleTap(): void;
  onEscape(): void;
  /** Enter approves a pending tool confirmation. */
  onEnter(): void;
  /**
   * The user scrolled, clicked, or pressed an ordinary key. Scrolls and
   * clicks mean what's under any drawings is changing; keys matter to a
   * walkthrough waiting on a keyboard-shortcut step.
   */
  onScreenInteraction(
    event:
      | { kind: "click"; x: number; y: number }
      | { kind: "wheel" }
      | { kind: "key" },
  ): void;
}

interface ChordSlot {
  get(): string;
  down(): void;
  up(heldMs: number): void;
  cancel(): void;
  active: boolean;
  startedAt: number;
}

export function startHotkeys(callbacks: HotkeyCallbacks): void {
  const taps = createTapCounter();

  // The double fires on the second tap-up, instantly, and consumes the sequence.
  function onControlTaps(count: number): void {
    if (count !== 2 || !callbacks.isDoubleTapArmed()) return;
    taps.reset();
    callbacks.onDoubleTap();
  }

  // Most specific first: the press-once chords always carry an ordinary
  // key, and the agent chord is usually a superset of the talk chord
  // (adding Shift upgrades Control+Alt into it). Only one may be active.
  const chords: ChordSlot[] = [
    {
      get: callbacks.getAlwaysOnChord,
      down: callbacks.onAlwaysOnChord,
      up: () => undefined,
      cancel: () => undefined,
      active: false,
      startedAt: 0,
    },
    {
      get: callbacks.getQuickAskChord,
      down: callbacks.onQuickAskChord,
      up: () => undefined,
      cancel: () => undefined,
      active: false,
      startedAt: 0,
    },
    {
      get: callbacks.getAgentChord,
      down: callbacks.onAgentChordDown,
      up: callbacks.onAgentChordUp,
      cancel: callbacks.onAgentChordCancel,
      active: false,
      startedAt: 0,
    },
    {
      get: callbacks.getChord,
      down: callbacks.onChordDown,
      up: callbacks.onChordUp,
      cancel: callbacks.onChordCancel,
      active: false,
      startedAt: 0,
    },
  ];

  /** All keycodes belonging to a chord: its modifiers' variants plus its key. */
  function codesOf(slot: ChordSlot): number[] {
    const chord = parseChord(slot.get());
    if (!chord) return [];
    const codes = chord.modifiers.flatMap((name) => MODIFIER_CODES[name]);
    if (chord.key) {
      const code = uiohookCodeFor(chord.key);
      if (code === undefined) return []; // unpredictable key: never activates
      codes.push(code);
    }
    return codes;
  }

  /**
   * The chord's modifiers are down and no other modifier is, per the OS
   * flags on this very event. Deriving state from the flags (instead of
   * tracking key-downs ourselves) keeps the chords immune to dropped
   * events — the agent's synthetic typing floods uiohook, and a missed
   * key-up used to leave ghost "held" keys that disabled the hotkey until
   * the app was restarted.
   */
  function modifiersSatisfied(
    slot: ChordSlot,
    event: UiohookKeyboardEvent,
  ): boolean {
    const chord = parseChord(slot.get());
    if (!chord) return false;
    return (Object.keys(MODIFIER_FLAGS) as ChordModifier[]).every(
      (name) => MODIFIER_FLAGS[name](event) === chord.modifiers.includes(name),
    );
  }

  /**
   * A chord activates on the key-down of the piece that completes it: its
   * ordinary key when it has one (so Control+Alt+Space never fires from the
   * modifiers alone), otherwise any of its own modifiers.
   */
  function activatesOn(slot: ChordSlot, event: UiohookKeyboardEvent): boolean {
    const chord = parseChord(slot.get());
    if (!chord) return false;
    if (chord.key) {
      const code = uiohookCodeFor(chord.key);
      return (
        code !== undefined &&
        event.keycode === code &&
        modifiersSatisfied(slot, event)
      );
    }
    return (
      chord.modifiers.some((name) =>
        MODIFIER_CODES[name].includes(event.keycode),
      ) && modifiersSatisfied(slot, event)
    );
  }

  /** Alt/Shift/Meta joining a Control tap makes it a chord, per the OS flags. */
  function otherModifierDown(event: UiohookKeyboardEvent): boolean {
    return event.altKey || event.shiftKey || event.metaKey;
  }

  uIOhook.on("keydown", (event) => {
    const isControl = CONTROL_CODES.has(event.keycode);
    taps.handle({
      type: "down",
      isControl,
      otherModifierDown: otherModifierDown(event),
      time: Date.now(),
    });

    if (event.keycode === UiohookKey.Escape) callbacks.onEscape();
    if (
      event.keycode === UiohookKey.Enter ||
      event.keycode === UiohookKey.NumpadEnter
    ) {
      callbacks.onEnter();
    }

    // A key outside an active chord cancels it — a normal shortcut, or the
    // extra modifier that upgrades the talk chord into the agent chord.
    // Escape is exempt: while a chord is held it clears the turn's marks
    // (or cancels the ask) via onEscape, without ending the hold itself.
    // Mouse clicks and drags never reach this handler, so drawing marks
    // while talking can't cancel the chord either.
    if (event.keycode !== UiohookKey.Escape) {
      for (const slot of chords) {
        if (slot.active && !codesOf(slot).includes(event.keycode)) {
          slot.active = false;
          slot.cancel();
        }
      }
    }
    // A chord activates only on the key-down that completes it.
    for (const slot of chords) {
      if (chords.some((c) => c.active)) break;
      if (activatesOn(slot, event)) {
        slot.active = true;
        slot.startedAt = Date.now();
        slot.down();
      }
    }

    // An ordinary key is the user acting on the screen — a walkthrough step
    // like "press Shift+A" completes on it. Modifiers alone are not an act
    // (they lead chords), and Escape is the stop key, never a step.
    if (
      !MODIFIER_KEYCODES.has(event.keycode) &&
      event.keycode !== UiohookKey.Escape
    ) {
      callbacks.onScreenInteraction({ kind: "key" });
    }
  });

  uIOhook.on("keyup", (event) => {
    const count = taps.handle({
      type: "up",
      isControl: CONTROL_CODES.has(event.keycode),
      otherModifierDown: otherModifierDown(event),
      time: Date.now(),
    });
    if (count > 0) onControlTaps(count);

    for (const slot of chords) {
      if (slot.active && codesOf(slot).includes(event.keycode)) {
        slot.active = false;
        slot.up(Date.now() - slot.startedAt);
      }
    }
  });

  // Scrolling or clicking moves the content Buddy drew on (or means the user
  // has acted on what was pointed at), so the annotations' moment is over.
  uIOhook.on("wheel", () => callbacks.onScreenInteraction({ kind: "wheel" }));
  uIOhook.on("mousedown", (event) => {
    mouseDown = true;
    callbacks.onScreenInteraction({ kind: "click", x: event.x, y: event.y });
  });
  uIOhook.on("mouseup", () => {
    mouseDown = false;
  });

  tryStart();
}

let mouseDown = false;

/** Is a mouse button held right now? Drag moves are not a shake gesture. */
export function isMouseButtonDown(): boolean {
  return mouseDown;
}

let started = false;
let retryTimer: NodeJS.Timeout | null = null;
let trustWatch: NodeJS.Timeout | null = null;
const TRUST_POLL_MS = 500;

/**
 * Accessibility is a launch-time fact for this process. uIOhook.start()
 * asks macOS for it the moment it runs, and that dialog belongs to the
 * onboarding permissions step, so the hook only starts when access is
 * already granted. It cannot change under a running process either way:
 * starting the hook after a grant has hung the main thread for good, and
 * a revoke while the hook's event tap is live stalls every click on the
 * Mac until the process dies. So any change relaunches Buddy — the walk
 * resumes where it was, as it already does after the Screen Recording grant.
 */
function tryStart(): void {
  if (process.platform === "darwin") {
    const trusted = systemPreferences.isTrustedAccessibilityClient(false);
    trustWatch ??= setInterval(() => {
      if (systemPreferences.isTrustedAccessibilityClient(false) === trusted)
        return;
      log.warn(
        `accessibility ${trusted ? "revoked" : "granted"} while running; relaunching`,
      );
      app.relaunch();
      // exit, not quit: a stuck event tap would block the hook's own stop.
      app.exit(0);
    }, TRUST_POLL_MS);
    if (!trusted) return;
  }
  try {
    uIOhook.start();
    started = true;
    log.info("global key listener started");
  } catch {
    log.warn("cannot listen for hotkeys; retrying in 10s");
    retryTimer = setTimeout(tryStart, 10_000);
  }
}

export function stopHotkeys(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  if (trustWatch) clearInterval(trustWatch);
  trustWatch = null;
  if (started) uIOhook.stop();
  started = false;
}
