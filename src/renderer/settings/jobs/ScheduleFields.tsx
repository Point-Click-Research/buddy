// The job form's When: an interval or a cadence, and for a cadence the time
// of day (any time, as the user wants it) and, for weekly and monthly, the
// day. The pieces read and write one schedule id (shared/jobs.ts).

import type { ReactElement } from 'react';
import {
  JOB_CADENCES,
  JOB_INTERVALS,
  WEEKDAY_NAMES,
  clockSchedule,
  clockScheduleId,
  parseClockTime,
  parseSchedule,
  type ClockSchedule,
  type JobCadence,
  type JobScheduleId,
} from '../../../shared/jobs';
import { MenuSelect, TextInput } from '../../ui';

const WHEN_OPTIONS = [...JOB_INTERVALS, ...JOB_CADENCES].map(({ id, label }) => ({ value: id, label }));
const WEEKDAY_OPTIONS = WEEKDAY_NAMES.map((name, day) => ({ value: String(day), label: name }));
const MONTH_DAYS = Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }));

function isCadence(value: string): value is JobCadence {
  return JOB_CADENCES.some((cadence) => cadence.id === value);
}

/** "09:05", the value a time field holds. */
function timeValue(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function ScheduleFields({
  value,
  onChange,
}: {
  value: JobScheduleId;
  onChange: (schedule: JobScheduleId) => void;
}): ReactElement {
  const parsed = parseSchedule(value);
  const clock = parsed && parsed.kind !== 'on-demand' && parsed.kind !== 'every' ? parsed : null;
  const setClock = (patch: Partial<Omit<ClockSchedule, 'kind'>>): void => {
    if (clock) onChange(clockScheduleId({ ...clock, ...patch }));
  };

  return (
    <>
      <MenuSelect
        label="When"
        value={clock ? clock.kind : value}
        options={WHEN_OPTIONS}
        onSelect={(picked) =>
          // A new cadence keeps the time already set; a fresh one is 9:00.
          onChange(isCadence(picked) ? clockScheduleId(clockSchedule(picked, { ...clock })) : picked)
        }
      />
      {clock ? (
        <div className={clock.day === undefined ? 'grid gap-3' : 'grid grid-cols-2 gap-3'}>
          <TextInput
            label="At"
            type="time"
            className="cursor-pointer [&::-webkit-calendar-picker-indicator]:cursor-pointer"
            value={timeValue(clock.hour, clock.minute)}
            onChange={(event) => {
              const time = parseClockTime(event.target.value);
              if (time) setClock(time);
            }}
          />
          {clock.kind === 'weekly' ? (
            <MenuSelect
              label="On"
              value={String(clock.day)}
              options={WEEKDAY_OPTIONS}
              onSelect={(day) => setClock({ day: Number(day) })}
            />
          ) : clock.kind === 'monthly' ? (
            <MenuSelect
              label="On the"
              value={String(clock.day)}
              options={MONTH_DAYS}
              onSelect={(day) => setClock({ day: Number(day) })}
            />
          ) : null}
        </div>
      ) : null}
    </>
  );
}
