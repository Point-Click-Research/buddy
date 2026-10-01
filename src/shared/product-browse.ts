// How Find Products opens pages. The chat page, the guide prompt, and the
// Shopping skill all read this so the choice and the behavior stay the same.

export type ProductBrowse = 'one' | 'rundown' | 'all';

export const PRODUCT_BROWSE_OPTIONS: ReadonlyArray<{
  value: ProductBrowse;
  label: string;
  detail: string;
}> = [
  {
    value: 'one',
    label: 'One at a time',
    detail: 'Opens one product, then waits until you ask for the next.',
  },
  {
    value: 'rundown',
    label: 'Rundown',
    detail: 'Opens one product, explains it, then moves to the next on its own.',
  },
  {
    value: 'all',
    label: 'All at once',
    detail: 'Opens every pick in its own tab.',
  },
];

export function isProductBrowse(value: unknown): value is ProductBrowse {
  return PRODUCT_BROWSE_OPTIONS.some((option) => option.value === value);
}

/** Asked once the picks are on screen: the answer tunes the next round. */
const FEEDBACK_ASK =
  'and that if they have feedback on the pick — what works, what does not — it helps you make better suggestions.';

/** What every mode does when a link dies. */
const COMMON =
  'A browser_tabs open refused as gone means the link is broken: say so in a few words ("looks like that link is broken, moving on") and go straight to the next option, never a search. If the screenshot shows the page you last opened is a not-found page or the item is unavailable, say so the same way and move on.';

/**
 * Feedback on a pick is the whole point of asking for it: it is a durable
 * preference, and saving it is what makes the next round better. The memory
 * rule in the prompt covers facts in general; this spells out that a reaction
 * to the product in front of them counts, and that the save comes first.
 */
const FEEDBACK_RULE =
  'Every reaction to a pick is a preference to remember: a like ("I like these", "those are cool"), a dislike, or a reason ("too chunky", "I hate all-black sneakers", "that\'s for kids"). Before you answer it, call save_memory with shopper (whoever the shopping is for) and category products, one short fact in their words that names the product, brand, or trait ("likes the Larroude George sneaker in white and red", "hates all-black sneakers"). Then reply in one line. Never say you noted, saved, or remembered anything unless save_memory returned saved this turn; if they ask whether you took note and you did not, say so and save it now.';

/**
 * Finds are for looking at. The search and the tabs are one turn: asking
 * "want me to open that?" makes them say yes to something they already asked for.
 */
const OPEN_NOW =
  'Open the pages in the same turn you find them. Never ask whether to show them, never summarize the picks and then wait, and never describe a pick before its tab is open. The first words are about the tab that just opened.';

/** What a strong like leads to: an offer to order, or nothing, depending on whether checkout exists. */
function likeRule(canOrder: boolean): string {
  return canOrder
    ? 'When they say they really like the pick in front of them, save it first, then ask in one short question whether you should order it. "Add it to cart", "buy it", or a size to order is a checkout, not a memory: propose the checkout task for that page with the size they said.'
    : 'No checkout is set up, so never offer to order, buy, or check out a pick. If they ask you to buy one or add it to cart, call open_settings with page buy and say in one short sentence to add a card and address there.';
}

/**
 * The presentation rule for this choice. Appended to the Shopping skill and
 * the guide prompt. `canOrder` is whether a checkout path exists right now.
 */
export function productBrowseInstruction(mode: ProductBrowse, canOrder = false): string {
  const rule =
    mode === 'all'
      ? `Showing finds is all at once. Call browser_tabs open once for each option in this same turn, best match first, then talk through the open tabs — what each is, the price, why it made the list — ask which they liked, and say that feedback on these picks helps you make better suggestions next time. Do not wait between tabs, do not ask which to open first, and do not walk them through one by one.`
      : mode === 'rundown'
        ? `Showing finds is a rundown. Go through every option in this same turn without waiting to be asked, one step per option: browser_tabs open on one product page, then one or two sentences about that option alone — what it is, the price, why it made the list — then, in your next step, the next open. Never put two opens in one step; the second is refused. The page opens as you start talking about it, and the next open waits until that sentence has been heard, so the pace is set for you; never ask whether to continue. After the last one, say that's all of them, ask which they liked, ${FEEDBACK_ASK}`
        : `Showing finds is one at a time. browser_tabs open on the first product page, one short sentence about that option alone — what it is, the price, why it made the list, never a word about the others — then tell them to say when they are ready for the next one ${FEEDBACK_ASK} Then stop. A second tab in the same turn is refused. Each later "next" ("what else", "show me another") is exactly two calls — one browser_tabs open on an option already gathered, one sentence — never a new search: the remaining options are already in the conversation. Search again only when their criteria changed (a new budget, color, or style) or the gathered list has truly run out, and then it is one search carrying every current criterion, not one per store. After the last one, say that's all of them and ask which they liked or whether to look differently.`;
  return `${OPEN_NOW} ${rule} ${COMMON} ${FEEDBACK_RULE} ${likeRule(canOrder)} This choice overrides any other pace.`;
}
