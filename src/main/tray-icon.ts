// The tray icon as embedded base64 PNGs (a simple filled circle).
// Embedding avoids shipping binary assets for now. Both are pure black with
// alpha and marked as a macOS "template image" so the OS tints them to match
// light/dark menu bars. Regenerate with any PNG tool if the design changes.

import { nativeImage } from 'electron';

const ICON_16 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAOdEVYdFNvZnR3YXJlAEZpZ21hnrGWYwAAANFJREFUeAGNUm0VwjAMzA8E4IBKwAGTMAlzgATmoHUwHICTSqgEJJRkpHtp+kHz3r293XK3a1KAsq4IiwiIyPCIDWGgU2d+UtNLiDWs6M3EXnFrx8RrE8sftPOM+HSSHJETaaAs4kLDZKKGTRAz1IuS1ebigM+TiAX6tSoDSpYR6x8DSvKQmpNquKj3BXGD390gsam5ygG9BX+H9hrlOvdBZAT/MQ6AFrCvQg7FQHv3GibFdcpkROzEcY+rHAdRXOVk4gb/XIhlGcRTJQosnHTzF5rki+tG4Iw4AAAAAElFTkSuQmCC';

const ICON_32 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAOdEVYdFNvZnR3YXJlAEZpZ21hnrGWYwAAAZpJREFUeAHNl4FxwjAMRX97HYAN6g2aEbJBGcEjZAOyAekE0AloJ8gxAXSCsAHdgErFFFMsYsXOte/uX8CRJdlWnBj4Y+4UthNSQXomlSTj2phP0tZpTXpDZixpTzpEqiPNXJLZqBUJ+IlYDKQItFUDkmDNoWRBaoR7BseRaZNYIJJ5RAdDajHCTFjPuEU/9YAkKtwYVYfLAoqBHWqeELadhBzNAoaxGOjqog45CTmYQJfECgNnYSoYGuipI5Mo/U6NYDTFMCz66+LiMW8FI4vhGNyui41vLGVbIw1eZ6kuvov83jOUHKQEN6R30k64j4ceJwZxQQp3ffR+q5KXlmBzo88M+l3waglObASjTgg+TQzOatnRqQbWQiATaOMpXiCdD/9PCTlTg8uEOqSP/mqP4YKR6qAYIfjP0p6WgD8qXxDGuOsK+b7xXkON0ixYnD9Sco3eQKASOhwyyqKHJnNAXw0iWY4QfAklOWcieuS/sUirAS7qCokYHF/LmkT2rk/vC0lzOGV49ypJTzhuUP7hdIfzwXTr2v4/X/hVwbff84JnAAAAAElFTkSuQmCC';

export function createTrayIcon(): Electron.NativeImage {
  const icon = nativeImage.createEmpty();
  icon.addRepresentation({ scaleFactor: 1, buffer: Buffer.from(ICON_16, 'base64') });
  icon.addRepresentation({ scaleFactor: 2, buffer: Buffer.from(ICON_32, 'base64') });
  // Template images are auto-tinted by macOS; harmless on other platforms.
  icon.setTemplateImage(true);
  return icon;
}
