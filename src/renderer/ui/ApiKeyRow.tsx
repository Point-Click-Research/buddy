import { useRef, useState, type ReactElement } from 'react';
import { cn, controlClass } from './cn';
import { Field } from './Field';
import { CheckIcon, XIcon } from './icons';
import { LinkButton } from './LinkButton';
import { SiteIcon } from './SiteIcon';
import { TextInput } from './TextInput';
import { errorMessage } from '../../shared/errors';

/** Dummy text so a saved key looks occupied without leaking length or contents. */
const KEY_MASK = 'weporifjpweoirjfpoiwejrfepimvew943';

/** The cloud-provider key row: icon, blurred mask once saved, optional test. */
export function ApiKeyRow({
  name,
  host,
  saved,
  error,
  onSave,
  onRemove,
  onTest,
}: {
  name: string;
  host: string;
  saved: boolean;
  error?: string;
  onSave: (value: string) => Promise<unknown>;
  onRemove: () => Promise<unknown> | void;
  onTest?: () => Promise<{ ok: boolean; message: string }>;
}): ReactElement {
  const [draft, setDraft] = useState('');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const generation = useRef(0);

  const save = async (): Promise<void> => {
    const value = draft.trim();
    if (!value) return;
    setLocalError(null);
    try {
      await onSave(value);
      setDraft('');
      setResult(null);
    } catch (err) {
      setLocalError(errorMessage(err));
    }
  };

  const test = async (): Promise<void> => {
    if (!onTest || testing) return;
    const run = ++generation.current;
    setTesting(true);
    setResult(null);
    try {
      const next = await onTest();
      if (run !== generation.current) return;
      setResult({ ok: next.ok, message: next.message });
    } finally {
      if (run === generation.current) setTesting(false);
    }
  };

  const remove = async (): Promise<void> => {
    generation.current += 1;
    setTesting(false);
    setResult(null);
    setLocalError(null);
    await onRemove();
  };

  const fieldError = localError || error || undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 font-medium">
          <SiteIcon host={host} />
          {name}
        </span>
        {saved ? (
          <span className="flex items-center gap-1 text-[12px] font-regular text-muted">
            {onTest ? <TestControl testing={testing} result={result} onTest={() => void test()} /> : null}
            {onTest ? '·' : null}
            <LinkButton tone="danger" onClick={() => void remove()}>
              Remove
            </LinkButton>
          </span>
        ) : null}
      </div>
      {saved ? (
        <Field error={fieldError}>
          <div
            className={cn(controlClass, 'flex h-10 items-center overflow-hidden px-3')}
            aria-label={`${name} API key is set`}
          >
            <span className="pointer-events-none select-none blur-[5px]" aria-hidden>
              {KEY_MASK}
            </span>
          </div>
        </Field>
      ) : (
        <TextInput
          autoComplete="off"
          spellCheck={false}
          placeholder="Paste API key to set"
          value={draft}
          error={fieldError}
          onChange={(event) => {
            setDraft(event.target.value);
            setLocalError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void save();
          }}
          action={draft.trim() ? { label: 'Save Key', onClick: () => void save() } : undefined}
        />
      )}
    </div>
  );
}

function TestControl({
  testing,
  result,
  onTest,
}: {
  testing: boolean;
  result: { ok: boolean; message: string } | null;
  onTest: () => void;
}): ReactElement {
  if (testing) {
    return (
      <span
        className="inline-block size-3.5 animate-spin rounded-full border-[1.5px] border-line border-t-muted"
        aria-label="Testing key"
      />
    );
  }
  if (result) {
    return (
      <LinkButton
        className="inline-flex items-center"
        tone={result.ok ? 'muted' : 'danger'}
        title={result.message}
        aria-label={result.ok ? 'Key works. Test again.' : `${result.message}. Test again.`}
        onClick={onTest}
      >
        {result.ok ? <CheckIcon /> : <XIcon />}
      </LinkButton>
    );
  }
  return <LinkButton onClick={onTest}>Test</LinkButton>;
}
