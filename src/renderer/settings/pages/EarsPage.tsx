// Settings → Ears: the local Whisper ear (downloaded once, then offline) and
// the vocabulary that fixes what it mishears. There is no provider to pick:
// transcription happens on this Mac.

import { useEffect, useState, type ReactElement } from 'react';
import { buddy } from '../../buddy';
import { Button, Card, Note, PairTable, SectionHeader, SiteIcon, TabbedView } from '../../ui';
import { useSettings } from '../context';

export function EarsPage(): ReactElement {
  const { view, patch } = useSettings();
  const { settings } = view;

  const listening = (
    <>
      <SectionHeader title="Listening" description="Speech to text, on this Mac. Nothing you say is uploaded." />
      <Card>
        <LocalWhisper />
      </Card>
    </>
  );

  const vocabulary = (
    <>
      <SectionHeader title="Vocabulary" description="Fix names and jargon Buddy mishears." />
      <PairTable
        labelA="The word"
        labelB="Buddy hears it as"
        placeholderA="OAuth"
        placeholderB="Oh Off (optional)"
        requireA
        rows={settings.vocabulary.map((entry) => ({ a: entry.word, b: entry.heard }))}
        onSave={(pairs) => void patch({ vocabulary: pairs.map((pair) => ({ word: pair.a, heard: pair.b })) })}
      />
      <Note>“Heard as” is optional if the word alone is enough.</Note>
    </>
  );

  return (
    <TabbedView
      tabs={[
        { id: 'listening', label: 'Listening', panel: listening },
        { id: 'vocabulary', label: 'Vocabulary', panel: vocabulary },
      ]}
    />
  );
}

/** The local ear: one row, one download button. A first ask downloads it too. */
export function LocalWhisper(): ReactElement {
  const [ready, setReady] = useState<boolean | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void buddy.getLocalWhisperReady().then(setReady);
    buddy.onLocalWhisperProgress(setPercent);
  }, []);

  const download = async (): Promise<void> => {
    setError(null);
    setPercent(0);
    setDownloading(true);
    const result = await buddy.downloadLocalWhisper();
    setDownloading(false);
    if (result.ok) setReady(true);
    else setError(result.message);
  };

  if (ready === null) return <Note>Checking…</Note>;
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="m-0 flex items-center gap-2 text-[13px]">
            <SiteIcon host="openai.com" />
            Whisper (base)
          </p>
          <p className="m-0 text-[12px] text-muted">Local speech recognition. ~90 MB, then offline.</p>
        </div>
        {ready ? (
          <Note tone="ok">Installed</Note>
        ) : (
          <Button variant="secondary" disabled={downloading} onClick={() => void download()}>
            {downloading ? `${percent}%` : 'Download'}
          </Button>
        )}
      </div>
      {error && <Note tone="fail">{error}</Note>}
    </>
  );
}
