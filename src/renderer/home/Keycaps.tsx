// The walk's hotkey, as the keys themselves: a mechanical keycap per key in
// the chord, sunk the moment the real key goes down. The window sees its own
// keydowns while it has focus; when the user is elsewhere, the chord landing
// in main (Buddy listening) presses every cap at once.

import { AudioLines } from 'lucide-react';
import { useEffect, useState, type ReactElement } from 'react';
import { chordLabel, MAC_SYMBOLS, modifierFromCode, parseChord, type ChordModifier } from '../../shared/hotkeys';

/** What Apple prints under the glyph. */
const KEY_NAMES: Record<ChordModifier, string> = {
  Control: 'control',
  Alt: 'option',
  Shift: 'shift',
  Meta: 'command',
};

/** Which modifier keys are down in this window right now. */
function useHeldModifiers(): ReadonlySet<ChordModifier> {
  const [held, setHeld] = useState<ReadonlySet<ChordModifier>>(new Set());
  useEffect(() => {
    const change = (down: boolean) => (event: KeyboardEvent) => {
      const modifier = modifierFromCode(event.code);
      if (!modifier) return;
      setHeld((current) => {
        if (current.has(modifier) === down) return current;
        const next = new Set(current);
        if (down) next.add(modifier);
        else next.delete(modifier);
        return next;
      });
    };
    const onDown = change(true);
    const onUp = change(false);
    const release = (): void => setHeld(new Set());
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', release);
    };
  }, []);
  return held;
}

export function Keycaps({
  chord,
  pressed,
  say,
}: {
  chord: string;
  /** The whole chord is down (Buddy is listening), wherever the keys were pressed. */
  pressed: boolean;
  /** What to say while holding, in the bubble under the keys. */
  say: string;
}): ReactElement {
  const held = useHeldModifiers();
  const parsed = parseChord(chord);
  return (
    <div className="flex flex-col items-center gap-5 py-2">
      <div className="flex items-center gap-4 text-[15px] text-muted">
        <span>Hold</span>
        <div className="keyplate flex items-end gap-3 rounded-[22px] p-3.5">
          {parsed?.modifiers.map((modifier) => (
            <Keycap
              key={modifier}
              glyph={MAC_SYMBOLS[modifier]}
              name={KEY_NAMES[modifier]}
              down={pressed || held.has(modifier)}
            />
          ))}
          {parsed?.key ? <Keycap glyph={chordLabel(parsed.key)} name="" down={pressed} /> : null}
        </div>
        <span>and say</span>
      </div>
      <p className="say-bubble m-0 flex items-center gap-2 rounded-full border border-line bg-raised px-4 py-2 text-[15px] font-medium shadow-card">
        <AudioLines className="size-4 text-muted" strokeWidth={1.75} aria-hidden />
        {`“${say}”`}
      </p>
    </div>
  );
}

function Keycap({ glyph, name, down }: { glyph: string; name: string; down: boolean }): ReactElement {
  return (
    <div className="keycap" data-down={down} aria-label={name || glyph}>
      <span className="text-[30px] leading-none">{glyph}</span>
      {name ? <span className="text-[12px] leading-none text-muted">{name}</span> : null}
    </div>
  );
}
