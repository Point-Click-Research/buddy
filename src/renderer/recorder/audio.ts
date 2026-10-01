// PCM helpers shared by the hold-to-talk recorder and the always-on VAD.
// Everything speech-to-text touches is 16 kHz mono little-endian PCM16.

/** Float samples to the little-endian 16-bit PCM every speech API expects. */
export function toPcm16(samples: Float32Array): Uint8Array {
  const pcm = new DataView(new ArrayBuffer(samples.length * 2));
  for (let i = 0; i < samples.length; i++) {
    pcm.setInt16(i * 2, Math.max(-1, Math.min(1, samples[i]!)) * 0x7fff, true);
  }
  return new Uint8Array(pcm.buffer);
}

/** One contiguous buffer from the recording's streamed chunks. */
export function concatPcm(chunks: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Wrap raw PCM16 in a WAV header (16 kHz mono, 16-bit). */
export function wavFromPcm16(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const out = new Uint8Array(44 + pcm.length);
  const view = new DataView(out.buffer);
  const writeString = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}
