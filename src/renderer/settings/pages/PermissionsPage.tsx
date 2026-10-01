// The macOS permissions Buddy can't work without. These gate the first-run
// banner, with a Grant button per missing one, polled so grants show up live.

import { useEffect, useState, type ReactElement } from 'react';
import type { PermissionName, PermissionsStatus } from '../../../shared/types';
import { buddy } from '../../buddy';
import { Button, Skeleton, Table, TableRow } from '../../ui';

const REQUIRED: { name: PermissionName; label: string; why: string }[] = [
  { name: 'microphone', label: 'Microphone', why: 'Hear you when you talk to Buddy.' },
  { name: 'screen', label: 'Screen recording', why: 'See the screen for visual answers.' },
  { name: 'accessibility', label: 'Accessibility', why: 'Move mouse and type for agent tasks.' },
];

const POLL_MS = 3000;

/** Keep the last poll so Providers ↔ Permissions does not flash "unknown". */
let lastStatus: PermissionsStatus | null = null;

/** The permissions, polled while `active` so a grant made in System Settings shows up live. */
export function usePermissions(active = true): { status: PermissionsStatus | null; refresh: () => void } {
  const [status, setStatus] = useState<PermissionsStatus | null>(lastStatus);

  const refresh = (): void => {
    void buddy.getPermissions().then((next) => {
      lastStatus = next;
      setStatus(next);
    });
  };

  useEffect(() => {
    if (!active) return;
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [active]);

  return { status, refresh };
}

export function PermissionsPage(): ReactElement {
  const { status, refresh } = usePermissions();

  const grant = (name: PermissionName): void => {
    void buddy.requestPermission(name).then(refresh);
  };

  return (
    <>
      <Table
        columns={[
          { key: '#', label: '#' },
          { key: 'main', label: 'Permission' },
          { key: 'action', label: '' },
        ]}
      >
        {REQUIRED.map(({ name, label, why }, index) => {
          const state = status?.[name];
          const granted = state === 'granted';
          return (
            <TableRow
              key={name}
              index={index + 1}
              main={
                <span className="flex items-center gap-2">
                  {label}
                  {!state ? (
                    <Skeleton className="h-3 w-16" />
                  ) : granted ? (
                    <span className="font-medium text-[11px] text-ok"> · Granted</span>
                  ) : (
                    <span className="font-medium text-[11px] capitalize text-danger"> · {state.replace('-', ' ')}</span>
                  )}
                </span>
              }
              detail={why}
              action={state && !granted ? <Button onClick={() => grant(name)}>Grant</Button> : null}
            />
          );
        })}
      </Table>
    </>
  );
}
