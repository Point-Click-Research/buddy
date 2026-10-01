// The floating card of the walk's permissions step, above the System
// Settings list Grant opened. For Screen Recording and Accessibility it
// holds Buddy's own icon, to be dragged into the list: the drag itself is
// the OS's, started by main with the app bundle as its payload; this window
// only hands over the gesture. The Microphone list takes no drop; Buddy is
// already in it, switched off, so the card only says to switch it on.

import { ArrowDownToLine, ToggleRight } from 'lucide-react';
import type { ReactElement } from 'react';
import type { PermissionName } from '../../shared/types';
import { buddy } from '../buddy';
import icon from '../../../build/icon.png';

const LIST_NAMES: Record<PermissionName, string> = {
  microphone: 'Microphone',
  screen: 'Screen Recording',
  accessibility: 'Accessibility',
};

/** Which list the card is for, from the window's boot hash; null when this is the chat home. */
export function dragCardList(hash: string): PermissionName | null {
  const list = hash.replace(/^#drag-card-/, '');
  return hash !== list && list in LIST_NAMES ? (list as PermissionName) : null;
}

export function DragCard({ list }: { list: PermissionName }): ReactElement {
  const drag = list !== 'microphone';
  const Icon = drag ? ArrowDownToLine : ToggleRight;
  return (
    <div className="app-drag drag-card flex flex-col gap-2.5 rounded-base border border-line bg-raised p-3.5 text-[13px] leading-5">
      <p className="m-0 flex items-center gap-2">
        <Icon className="size-4 shrink-0 text-muted" strokeWidth={1.75} aria-hidden />
        <span>
          {drag ? 'Drag Buddy into the ' : 'Switch Buddy on in the '}
          <span className="font-medium">{LIST_NAMES[list]}</span> list{drag ? ', then switch it on.' : '.'}
        </span>
      </p>
      {drag ? (
        <div
          draggable
          onDragStart={(event) => {
            event.preventDefault();
            buddy.dragAppBundle();
          }}
          className="app-no-drag flex cursor-grab items-center gap-2.5 rounded-sm border border-line bg-canvas py-1.5 pl-1.5 pr-3 shadow-input active:cursor-grabbing"
        >
          <img src={icon} alt="" draggable={false} className="size-7 rounded-md" />
          <span className="font-medium">Buddy</span>
          <span className="flex-1" />
          <span className="text-[11px] text-faint">Drag me</span>
        </div>
      ) : null}
    </div>
  );
}
