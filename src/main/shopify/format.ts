// The Global Catalog's product shape, and how one product reads as a result
// line for the model. Pure module: no Electron, no network, fully testable.

import { moneyLabel, productLine as line } from '../product-line';

interface CatalogMoney {
  amount: number;
  currency: string;
}

export interface CatalogProduct {
  title?: string;
  url?: string;
  price_range?: { min?: CatalogMoney; max?: CatalogMoney };
  variants?: Array<{
    price?: CatalogMoney;
    availability?: { available?: boolean; status?: string };
    seller?: { name?: string; domain?: string };
  }>;
  rating?: { value?: number; scale_max?: number; count?: number };
}

/** "- Title — $89.99–$129.99 (Example Running, 4.5★ of 120) · https://…" */
export function productLine(product: CatalogProduct): string {
  const seller = product.variants?.find((variant) => variant.seller?.name)?.seller;
  const rating =
    product.rating?.value !== undefined ? `${product.rating.value}★ of ${product.rating.count ?? '?'}` : '';
  return line({ title: product.title, price: priceLabel(product), extras: [seller?.name, rating], url: product.url });
}

/** Prices arrive in minor units; a single-point range shows as one figure. */
function priceLabel(product: CatalogProduct): string {
  const min = product.price_range?.min;
  const max = product.price_range?.max;
  if (!min) return '';
  const one = (money: CatalogMoney): string => moneyLabel(money.amount / 100, money.currency);
  if (!max || max.amount === min.amount) return one(min);
  return `${one(min)}–${one(max)}`;
}
