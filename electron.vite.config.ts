import { defineConfig } from 'electron-vite';
import { resolve } from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// One preload script (src/preload/index.ts, the default) and two renderer
// pages. electron-vite builds main from src/main/index.ts by default.
export default defineConfig({
  main: {
    build: {
      // electron-vite externalizes all dependencies by default. Bundle the
      // ESM-only ones: a CJS require() of them fails.
      externalizeDeps: {
        exclude: ['electron-store', 'unpdf', '@composio/core', 'points-on-path'],
      },
      rollupOptions: {
        // jev.ts and locate-object.ts import Electron-backed modules lazily so
        // tests can load them without Electron; the bundle needs no split.
        onwarn(warning, warn) {
          if (!warning.message.includes('dynamic import will not move module into another chunk')) warn(warning);
        },
      },
    },
  },
  preload: {},
  renderer: {
    // Vite otherwise tries to parse the sphere model as JavaScript.
    assetsInclude: ['**/*.glb'],
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: {
          overlay: resolve(__dirname, 'src/renderer/overlay/index.html'),
          panel: resolve(__dirname, 'src/renderer/panel/index.html'),
          settings: resolve(__dirname, 'src/renderer/settings/index.html'),
          home: resolve(__dirname, 'src/renderer/home/index.html'),
          recorder: resolve(__dirname, 'src/renderer/recorder/index.html'),
          'quick-ask': resolve(__dirname, 'src/renderer/quick-ask/index.html'),
          browser: resolve(__dirname, 'src/renderer/browser/index.html'),
          boogle: resolve(__dirname, 'src/renderer/boogle/index.html'),
          'test-form': resolve(__dirname, 'src/renderer/dev/test-form.html'),
          'input-test': resolve(__dirname, 'src/renderer/dev/input-test.html'),
          'dev-marks': resolve(__dirname, 'src/renderer/dev/marks.html'),
        },
      },
    },
  },
});
