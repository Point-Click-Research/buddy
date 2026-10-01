// How one found product reads to the model, whatever source it came from.
// Every product tool renders the same line so the guide presents a Shopify
// catalog hit and an open-web hit identically. Pure module.

export interface ProductLine {
  title?: string;
  /** Already labeled ("$89.99", "$89.99–$129.99", "50.00 EUR"). */
  price?: string;
  /** Parenthesized after the price: seller, rating, stock. */
  extras?: Array<string | undefined>;
  url?: string;
}

/** "- Title — $89.99 (Seller, 4.5★ of 120) · https://…" */
export function productLine({ title, price, extras = [], url }: ProductLine): string {
  const detail = extras.filter(Boolean).join(', ');
  return [`- ${title || '(untitled)'}`, price ? `— ${price}` : '', detail ? `(${detail})` : '', url ? `· ${url}` : '']
    .filter(Boolean)
    .join(' ');
}

/** "$89.99" for dollars; other currencies spelled out rather than faked with a dollar sign. */
export function moneyLabel(amount: number, currency?: string): string {
  const value = amount.toFixed(2);
  return currency === 'USD' || !currency ? `$${value}` : `${value} ${currency}`;
}
