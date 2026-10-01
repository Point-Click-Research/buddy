// Overlay colours: a 6-digit hex, or disco — cycle the hue spectrum.

/** Stored in place of a hex: the overlay animates this colour through the rainbow. */
export const DISCO_COLOR = 'disco';

/** Vivid pink for colour inputs and anywhere a still hex is required. */
export const DISCO_PREVIEW = '#ff2d78';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function isDiscoColor(value: string): boolean {
  return value === DISCO_COLOR;
}

export function isOverlayColor(value: string): boolean {
  return HEX_COLOR.test(value) || value === DISCO_COLOR;
}

/** A still hex for colour inputs and screenshot SVG. Disco becomes the preview pink. */
export function solidHexColor(value: string): string {
  return HEX_COLOR.test(value) ? value : DISCO_PREVIEW;
}

/**
 * CSS colour for overlay variables: the hex as stored, or an hsl tied to
 * `--disco-hue` so every disco colour rides the same spinning spectrum.
 * `hueShift` keeps two disco colours from landing on the same hue at once.
 */
export function overlayCssColor(value: string, hueShift = 0): string {
  if (value !== DISCO_COLOR) return value;
  const hue = hueShift === 0 ? 'var(--disco-hue)' : `calc(var(--disco-hue) + ${hueShift})`;
  return `hsl(${hue} 88% 56%)`;
}

/** Settings keys, overlay CSS variables, and disco hue offsets. */
export const OVERLAY_COLORS = [
  { key: 'colorIdleDot', css: '--dot-idle', shift: 0 },
  { key: 'colorSpeakingDot', css: '--dot-speaking', shift: 45 },
  { key: 'colorBuddySpeakingDot', css: '--dot-buddy', shift: 90 },
  { key: 'colorLoadingDot', css: '--dot-loading', shift: 135 },
  { key: 'colorDrivingFrame', css: '--driving', shift: 180 },
  { key: 'colorAnnotations', css: '--accent', shift: 225 },
  { key: 'colorErrorBubble', css: '--error', shift: 270 },
  { key: 'colorUserMarks', css: '--user-marks', shift: 315 },
] as const;
