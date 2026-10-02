// What a new chat opens on: the composer at the optical center of the window,
// the greeting above it, and today's suggestions below it. Suggestions scroll
// in their own space, so however many there are, the composer never moves.

import { type ReactElement, type ReactNode } from 'react';
import { dayPart } from '../../shared/greeting';
import { useAccount } from '../shared/account-data';

export function EmptyChat({
  composer,
  centered,
  children,
}: {
  composer: ReactNode;
  /** Nothing is listed below, so the composer settles lower, nearer true center. */
  centered: boolean;
  children: ReactNode;
}): ReactElement {
  // A 4:5 split sets the composer a little above true center, which reads as centered with a list
  // under it; alone, it eases down to 9:8. minmax(0, …) so a long list scrolls instead of growing its share.
  return (
    <div
      className={`grid min-h-0 flex-1 overflow-visible px-6 transition-[grid-template-rows] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
        centered ? 'grid-rows-[minmax(0,9fr)_auto_minmax(0,8fr)]' : 'grid-rows-[minmax(0,4fr)_auto_minmax(0,5fr)]'
      }`}
    >
      <div className="flex flex-col justify-end overflow-visible pb-6">
        <Greeting />
      </div>
      <div className="mx-auto w-full max-w-2xl overflow-visible">{composer}</div>
      {/* The scroller is inside the row. Overflow on the row itself clips the
          composer's glow, which spills into the cells above it. */}
      <div className="min-h-0 overflow-visible pb-10 pt-6">
        <div className="h-full overflow-y-auto [mask-image:linear-gradient(to_bottom,black_calc(100%-40px),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="mx-auto w-full max-w-2xl">{children}</div>
        </div>
      </div>
    </div>
  );
}

/** "Good afternoon, Zach": the time of day, and their first name once they have given one. */
function Greeting(): ReactElement {
  const name = useAccount()?.firstName;
  return (
    <h1 className="m-0 text-center text-[24px] font-semibold tracking-tight text-ink">
      Good {dayPart()}
      {name ? `, ${name}` : ''}
    </h1>
  );
}
