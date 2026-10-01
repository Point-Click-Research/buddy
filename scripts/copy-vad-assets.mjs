// Copies the Silero VAD model, its audio worklet, and the onnxruntime wasm
// files into the renderer's public dir so always-on mode loads everything
// from disk instead of a CDN. Runs on postinstall (see package.json).

import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'src/renderer/public/vad');
mkdirSync(outDir, { recursive: true });

const vadDist = join(root, 'node_modules/@ricky0123/vad-web/dist');
const ortDist = join(root, 'node_modules/onnxruntime-web/dist');

const files = [
  [join(vadDist, 'vad.worklet.bundle.min.js'), 'vad.worklet.bundle.min.js'],
  [join(vadDist, 'silero_vad_v5.onnx'), 'silero_vad_v5.onnx'],
  [join(ortDist, 'ort-wasm-simd-threaded.wasm'), 'ort-wasm-simd-threaded.wasm'],
  [join(ortDist, 'ort-wasm-simd-threaded.mjs'), 'ort-wasm-simd-threaded.mjs'],
];

for (const [from, to] of files) {
  copyFileSync(from, join(outDir, to));
}
console.log(`[copy-vad-assets] copied ${files.length} files to src/renderer/public/vad`);
