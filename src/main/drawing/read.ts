// Reading a shape's fields, once, for every builder.
//
// Each of these either returns a usable value or nothing, so a builder never
// has to guess what the model meant. Pure module.

import { isError, resolveAnchor, type Anchored, type AnchorWorld } from './anchors';

export function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

/** One of a fixed set, the fallback when absent, or null when it's wrong. */
export function pick<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback: T[number],
): T[number] | null {
  if (value === undefined) return fallback;
  return typeof value === 'string' && allowed.includes(value) ? (value as T[number]) : null;
}

/** A number inside a range, or null — used for sides, angles and samples. */
export function bounded(value: unknown, min: number, max: number): number | null {
  const parsed = number(value);
  return parsed !== null && parsed >= min && parsed <= max ? parsed : null;
}

/** Resolve one named anchor field, labelling any error with the field name. */
export function anchorField(
  shape: Record<string, unknown>,
  field: string,
  world: AnchorWorld,
): Anchored | { error: string } {
  const resolved = resolveAnchor(shape[field], world);
  return isError(resolved) ? { error: `${field}: ${resolved.error}` } : resolved;
}

/** Resolve a list of anchors, naming which one failed. */
export function anchorList(
  raw: readonly unknown[],
  world: AnchorWorld,
): { anchors: Anchored[] } | { error: string } {
  const anchors: Anchored[] = [];
  for (const [index, value] of raw.entries()) {
    const anchor = resolveAnchor(value, world);
    if (isError(anchor)) return { error: `point ${index + 1}: ${anchor.error}` };
    anchors.push(anchor);
  }
  return { anchors };
}

export function arrowheads(value: unknown): { start: boolean; end: boolean } | { error: string } {
  const which = value === undefined ? 'none' : value;
  if (typeof which !== 'string' || !['none', 'start', 'end', 'both'].includes(which)) {
    return { error: 'arrowhead must be none, start, end or both.' };
  }
  return { start: which === 'start' || which === 'both', end: which === 'end' || which === 'both' };
}

/** A two-number range, e.g. an axis span. */
export function range(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const low = number(value[0]);
  const high = number(value[1]);
  return low !== null && high !== null && high > low ? [low, high] : null;
}
