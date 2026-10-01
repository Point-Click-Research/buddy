// Settings → Suggestions: whether Buddy offers things to take on, when the
// batch runs, how many, whether the first one reaches the phone and the
// screen, and whether safe ones run on their own. The batch lands under the
// composer on New Chat. Free gets one pass a day and no unasked runs; a paid
// plan on Buddy's bill runs the first safe one.

import type { ReactElement } from 'react';
import { autoRunCap, suggestionTimeFor, suggestionTimesFor } from '../../../shared/suggestions';
import { IDEAS_COUNT } from '../../../shared/types';
import { buddy } from '../../buddy';
import { useAccount } from '../../shared/account-data';
import { useIdeasView } from '../../shared/jobs-data';
import { Actions, Button, Card, MenuSelect, SectionHeader, SliderInput, SwitchInput } from '../../ui';
import { useSettings } from '../context';

const AUTO_RUN_NOTES = {
  none: 'On Free, suggestions wait for your yes. Pro runs the safe ones on its own.',
  first: 'Buddy opens the pick or drafts the reply for the first safe suggestion, and reports in its thread. Your own OpenRouter key runs every safe one.',
  all: 'Buddy opens the pick or drafts the reply on its own and reports in that suggestion\'s thread. Purchases, bookings, calls, sends, and new jobs still wait for your yes.',
} as const;

export function SuggestionsPage(): ReactElement {
  const { view, patch } = useSettings();
  const account = useAccount();
  const ideas = useIdeasView();
  const { settings } = view;
  const checking = ideas?.running ?? false;
  const plan = account?.plan ?? null;
  const cap = autoRunCap(plan, view.keys.openrouter);
  const autoRunNote = cap === 0 ? AUTO_RUN_NOTES.none : cap === 1 ? AUTO_RUN_NOTES.first : AUTO_RUN_NOTES.all;
  return (
    <>
      <SectionHeader
        title="Suggestions"
        description="Things Buddy offers to take on, shown under the box on New Chat."
      />
      <Card>
        <SwitchInput
          label="Proactively suggest things to take on"
          subtitle="From recent chats, your inbox, open tabs, and connected apps. And in the moment, when your calendar calls for it: a car before a meeting across town, food before a flight."
          checked={settings.ideasEnabled}
          onChange={(ideasEnabled) => void patch({ ideasEnabled })}
        />
        {settings.ideasEnabled ? (
          <div className="fade-in flex flex-col gap-4.5">
            <MenuSelect
              label="When"
              subtitle="A slot Buddy sleeps through runs when it wakes. Suggest now runs right away."
              value={suggestionTimeFor(settings.ideasTime, plan)}
              options={suggestionTimesFor(plan).map(({ id, label }) => ({ value: id, label }))}
              onSelect={(ideasTime) => void patch({ ideasTime })}
            />
            <SliderInput
              label="How many"
              value={settings.ideasCount}
              min={IDEAS_COUNT.min}
              max={IDEAS_COUNT.max}
              onChange={(ideasCount) => void patch({ ideasCount })}
            />
            <SwitchInput
              label="Reach me"
              subtitle="Buddy texts you the first suggestion and says it from the dot on screen. The text needs Text Buddy. The rest wait on New Chat."
              checked={settings.ideasReach}
              onChange={(ideasReach) => void patch({ ideasReach })}
            />
            <SwitchInput
              label="Do safe suggestions without asking"
              subtitle={autoRunNote}
              checked={cap > 0 && settings.ideasAutoRun}
              disabled={cap === 0}
              onChange={(ideasAutoRun) => void patch({ ideasAutoRun })}
            />
            <Actions align="start">
              <Button variant="secondary" disabled={checking} onClick={() => void buddy.refreshIdeas()}>
                {checking ? 'Suggesting…' : 'Suggest now'}
              </Button>
            </Actions>
          </div>
        ) : null}
      </Card>
    </>
  );
}
