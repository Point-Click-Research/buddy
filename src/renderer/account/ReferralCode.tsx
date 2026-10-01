// Referral codes. Waitlisted: enter a code from someone already in. Already
// in: one code to share that moves waitlisted friends up.

import { useState, type ReactElement } from 'react';
import { buddy } from '../buddy';
import { TextInput } from '../ui';

export function ReferralCode(): ReactElement {
  const [code, setCode] = useState('');
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const redeem = (): void => {
    if (!code.trim()) return;
    void buddy.redeemReferral(code).then(setResult);
  };
  return (
    <TextInput
      label="Have a code?"
      subtitle="From someone already in. It moves you up."
      value={code}
      onChange={(event) => {
        setResult(null);
        setCode(event.target.value);
      }}
      onKeyDown={(event) => event.key === 'Enter' && redeem()}
      action={{ label: 'Use code', onClick: redeem, variant: 'secondary' }}
      info={result?.ok ? result.message : undefined}
      error={result && !result.ok ? result.message : undefined}
    />
  );
}

/** The one code this account can give. Copy puts it on the clipboard. */
export function MyReferralCode({ code, uses }: { code: string; uses: number }): ReactElement {
  const [copied, setCopied] = useState(false);
  const copy = (): void => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };
  const joined =
    uses === 0
      ? 'For friends still on the waitlist. It moves them up.'
      : `${uses === 1 ? '1 friend has' : `${uses} friends have`} moved up with it.`;
  return (
    <TextInput
      label="Your referral code"
      subtitle={joined}
      value={code}
      readOnly
      onChange={() => undefined}
      action={{ label: copied ? 'Copied' : 'Copy', onClick: copy, variant: 'secondary' }}
    />
  );
}
