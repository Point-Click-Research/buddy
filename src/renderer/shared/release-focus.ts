// A button clicked just before the window lost focus (Apps, a sidebar
// page) keeps keyboard focus, and when the window comes back Chromium draws
// its focus ring on it, a highlight nobody asked for. So focus is let go
// when the window loses it; only a field keeps it, so a half-typed message
// still takes the next keystroke.

const KEEPS_FOCUS = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

export function releaseFocusOnBlur(): void {
  window.addEventListener('blur', () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && !active.matches(KEEPS_FOCUS)) active.blur();
  });
}
