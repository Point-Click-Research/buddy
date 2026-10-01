// Settings → Checkout Forms: shipping, a payment method, and the rest of a
// checkout Buddy fills in. The Shopify Catalog key is under API keys.

import { useState, type ReactElement, type ReactNode } from 'react';
import { cardBrand, cardBrandNamed, formatCardNumber, formatCvc, formatExpiry } from '../../../shared/card-brand';
import { US_STATES } from '../../../shared/us-states';
import type { BuyerProfile, PaymentCardDraft, Settings } from '../../../shared/types';
import { buddy } from '../../buddy';
import {
  Button,
  Card,
  CardBrandStack,
  CardMark,
  CvcIcon,
  LinkButton,
  MenuSelect,
  Modal,
  Note,
  SectionHeader,
  SiteIcon,
  TextInput,
} from '../../ui';
import { useSettings } from '../context';

/** Side-by-side fields that share the row's width. */
function Row({ children }: { children: ReactNode }): ReactElement {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}

/** Buddy's own checkout path: the card fill_payment uses, and the addresses the agent types. */
export function BuyPage(): ReactElement {
  const { view, patch } = useSettings();
  const [explaining, setExplaining] = useState(false);
  return (
    <>
      <SectionHeader
        title="Payment card"
        description={
          <>
            The number stays in your Mac's Keychain, and Buddy types it into a checkout you approved. The model never
            sees it.{' '}
            <LinkButton tone="ink" className="text-[13px] underline" onClick={() => setExplaining(true)}>
              Learn more
            </LinkButton>
          </>
        }
      />
      {explaining ? <CardSafetyModal onClose={() => setExplaining(false)} /> : null}
      <Card>
        <PaymentCardForm saved={view.appKeys.card} />
        <TrustedMerchants
          hosts={view.settings.trustedMerchants}
          onRemove={(host) =>
            void patch({ trustedMerchants: view.settings.trustedMerchants.filter((h) => h !== host) })
          }
        />
      </Card>
      <SectionHeader
        title="Shipping address"
        description="Where orders go. Buddy fills this into checkout forms."
      />
      <Card>
        <ProfileFields settingsKey="buddyShipping" />
      </Card>
      <SectionHeader
        title="Billing address"
        description="For the card. Leave empty when it matches shipping."
      />
      <Card>
        <ProfileFields settingsKey="buddyBilling" contact={false} />
      </Card>
    </>
  );
}

/**
 * One name-and-address form, saved per keystroke to the named settings
 * profile. Billing skips the contact row: the card check wants a name and
 * address, and email and phone already live with shipping.
 */
function ProfileFields({
  settingsKey,
  contact = true,
}: {
  settingsKey: keyof Pick<Settings, 'buddyShipping' | 'buddyBilling'>;
  contact?: boolean;
}): ReactElement {
  const { view, patch } = useSettings();
  const profile = view.settings[settingsKey];
  const set = (key: keyof BuyerProfile, value: string): void => {
    void patch({ [settingsKey]: { ...profile, [key]: value } });
  };
  const text = (key: keyof BuyerProfile, label: string, placeholder: string, type = 'text'): ReactElement => (
    <TextInput
      label={label}
      type={type}
      placeholder={placeholder}
      autoComplete="off"
      value={profile[key]}
      onChange={(event) => set(key, event.target.value)}
    />
  );
  return (
    <>
      <Row>
        {text('firstName', 'First name', 'Ada')}
        {text('lastName', 'Last name', 'Lovelace')}
      </Row>
      {contact ? (
        <Row>
          {text('email', 'Email', 'ada@example.com', 'email')}
          {text('phone', 'Phone', '212-555-0100', 'tel')}
        </Row>
      ) : null}
      {text('address1', 'Street address', '123 Main St, Apt 4')}
      {text('city', 'City', 'New York')}
      <Row>
        <MenuSelect
          label="State"
          placeholder="Choose"
          searchable
          value={profile.province}
          options={US_STATES}
          onSelect={(province) => set('province', province)}
        />
        {text('postalCode', 'ZIP', '10001')}
      </Row>
    </>
  );
}

/** Each rule the card path enforces, in the order it is applied. Mirrors payment/card.ts, merchant.ts, fill-tool.ts, redact.ts. */
const CARD_SAFETY: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: 'Where it lives',
    body: 'The number, expiry, security code, and name are one encrypted entry in your Mac\'s Keychain. Memory refuses anything that looks like a card number, and no chat, text, or prompt ever includes the digits.',
  },
  {
    title: 'When it is used',
    body: 'Only a checkout you approved, in Buddy\'s own browser, on an HTTPS page at a store you already chose: a page Buddy opened for you, the tab in front when you approved the plan, a store named in that plan, or a merchant you have trusted below. A page cannot talk Buddy onto some other form.',
  },
  {
    title: 'What you see',
    body: 'With "confirm actions" on, a card shows the brand, the last four digits, the store, and the total before anything is typed. The model gets a yes or a no.',
  },
  {
    title: 'What the model never gets',
    body: 'From the first keystroke until the task ends, Buddy stops sending pictures of that screen, and any card number a page echoes back is masked before the model reads it.',
  },
  {
    title: 'The edge',
    body: 'A card you typed yourself, or one your own browser has saved, can still appear in an ordinary screenshot while Buddy is looking at your screen. That is screen awareness, and it is separate from checkout.',
  },
];

function CardSafetyModal({ onClose }: { onClose: () => void }): ReactElement {
  return (
    <Modal title="How Buddy keeps your card safe" onClose={onClose}>
      {CARD_SAFETY.map((rule) => (
        <div key={rule.title} className="flex flex-col gap-0.5">
          <span className="text-[13px] font-medium">{rule.title}</span>
          <p className="m-0 text-[13px] leading-5 text-muted">{rule.body}</p>
        </div>
      ))}
    </Modal>
  );
}

const EMPTY_CARD: PaymentCardDraft = { number: '', expiry: '', cvc: '', name: '' };

/** The card form, or the saved label with Remove. Validation happens in main. */
function PaymentCardForm({ saved }: { saved: string }): ReactElement {
  const [draft, setDraft] = useState<PaymentCardDraft>(EMPTY_CARD);
  const [error, setError] = useState<string | null>(null);
  const brand = cardBrand(draft.number);

  if (saved) {
    return (
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 font-medium">
          <CardMark brand={cardBrandNamed(saved)} />
          {saved} saved
        </span>
        <LinkButton tone="danger" onClick={() => void buddy.savePaymentCard(null)}>
          Remove
        </LinkButton>
      </div>
    );
  }

  const set = (key: keyof PaymentCardDraft, value: string): void => {
    setDraft({ ...draft, [key]: value });
    setError(null);
  };
  const save = async (): Promise<void> => {
    const message = await buddy.savePaymentCard(draft);
    setError(message);
    // On success the settings broadcast flips `saved`; drop the typed digits.
    if (!message) setDraft(EMPTY_CARD);
  };

  return (
    <>
      <TextInput
        label="Card number"
        placeholder="1234 1234 1234 1234"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        value={draft.number}
        onChange={(event) => set('number', formatCardNumber(event.target.value))}
        adornmentPad={brand.mark ? undefined : 'pr-36'}
        adornment={brand.mark ? <CardMark brand={brand} className="fade-in" /> : <CardBrandStack />}
      />
      <Row>
        <TextInput
          label="Expiry"
          placeholder="MM / YY"
          inputMode="numeric"
          autoComplete="off"
          value={draft.expiry}
          onChange={(event) => set('expiry', formatExpiry(event.target.value))}
        />
        <TextInput
          label="Security code"
          placeholder={brand.cvcLength === 4 ? 'CID' : 'CVC'}
          inputMode="numeric"
          autoComplete="off"
          value={draft.cvc}
          onChange={(event) => set('cvc', formatCvc(event.target.value, brand))}
          adornment={<CvcIcon />}
          adornmentPad="pr-10"
        />
      </Row>
      <TextInput label="Name on card" placeholder="Ada Lovelace" autoComplete="off" value={draft.name} onChange={(event) => set('name', event.target.value)} />
      {error ? <Note tone="fail">{error}</Note> : null}
      <Button onClick={() => void save()} disabled={!draft.number.trim()}>
        Save card
      </Button>
    </>
  );
}

/** Merchants fill_payment fills without asking again. Grows after each successful checkout. */
function TrustedMerchants({ hosts, onRemove }: { hosts: string[]; onRemove: (host: string) => void }): ReactElement | null {
  if (hosts.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-medium">Trusted merchants</span>
      {hosts.map((host) => (
        <div key={host} className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-muted">
            <SiteIcon host={host} />
            {host}
          </span>
          <LinkButton tone="danger" onClick={() => onRemove(host)}>
            Remove
          </LinkButton>
        </div>
      ))}
    </div>
  );
}
