// Every voice at once. Play uses ElevenLabs' free preview for that voice.
// Clicking the name selects; play does not.

import { Play, Square } from 'lucide-react';
import { useEffect, useSyncExternalStore, type ReactElement } from 'react';
import { VOICES } from '../../shared/voices';
import { buddy } from '../buddy';
import { Skeleton, Table, TableRow } from '../ui';

let audio: HTMLAudioElement | null = null;
let playing = '';
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function stopPreview(): void {
  audio?.pause();
  audio = null;
  if (!playing) return;
  playing = '';
  emit();
}

function startPreview(id: string, url: string): void {
  if (playing === id) {
    stopPreview();
    return;
  }
  audio?.pause();
  audio = new Audio(url);
  playing = id;
  audio.onended = stopPreview;
  void audio.play().catch(stopPreview);
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Play, or the shimmer of a preview still on its way. */
function PreviewButton({ id, name, url }: { id: string; name: string; url?: string }): ReactElement {
  const on = useSyncExternalStore(subscribe, () => playing === id);
  if (!url) return <Skeleton className="size-6 rounded-full" />;
  return (
    <button
      type="button"
      aria-label={on ? `Stop ${name}` : `Play ${name}`}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        event.preventDefault();
        startPreview(id, url);
      }}
      className="flex size-6 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-muted hover:bg-canvas hover:text-ink"
    >
      {on ? <Square className="size-2.5" fill="currentColor" aria-hidden /> : <Play className="size-3" fill="currentColor" aria-hidden />}
    </button>
  );
}

/** The catalog, plus the saved id when it is not one of them. */
export function VoiceSelect({
  value,
  onSelect,
}: {
  value: string;
  onSelect: (id: string) => void;
}): ReactElement {
  const previews = useSyncExternalStore(subscribePreviews, getPreviews);
  const known = VOICES.some((voice) => voice.id === value);
  const rows = [
    ...(known || !value ? [] : [{ id: value, name: value }]),
    ...VOICES.map((voice) => ({ id: voice.id, name: voice.name })),
  ];
  useEffect(() => {
    const missing = [value, ...VOICES.map((voice) => voice.id)].filter((id) => id && !asked.has(id));
    if (missing.length === 0) return;
    for (const id of missing) asked.add(id);
    void buddy.voicePreviews(missing)
      .then((next) => {
        urls = { ...urls, ...next };
        for (const id of missing) if (!next[id]) asked.delete(id);
        for (const listener of previewListeners) listener();
      })
      .catch(() => {
        for (const id of missing) asked.delete(id);
      });
  }, [value]);
  return (
    <Table
      columns={[
        { key: '#', label: '#' },
        { key: 'main', label: 'Voice' },
        { key: 'action', label: '' },
      ]}
    >
      {rows.map((voice, index) => {
        const selected = voice.id === value;
        return (
          <TableRow
            key={voice.id}
            index={index + 1}
            main={
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => onSelect(voice.id)}
                className="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left font-medium text-ink"
              >
                {voice.name}
                {selected ? <span className="text-[11px] font-medium text-ok">Selected</span> : null}
              </button>
            }
            action={<PreviewButton id={voice.id} name={voice.name} url={previews[voice.id]} />}
          />
        );
      })}
    </Table>
  );
}

const asked = new Set<string>();
let urls: Record<string, string> = {};
const previewListeners = new Set<() => void>();

function subscribePreviews(listener: () => void): () => void {
  previewListeners.add(listener);
  return () => previewListeners.delete(listener);
}

function getPreviews(): Record<string, string> {
  return urls;
}

