# Your agent shouldn't hold your credit card

_Draft, October 2026._

Every agent that can buy things has to answer one question: how does it pay?

So far the answers all give the agent something to hold. An environment variable with a card number. A virtual card printed into the context. A network token the platform carries on the agent's behalf. Each is better than the last. All of them share the same shape: something that can spend your money is handed to the agent.

A card number in a prompt sits in the model's context. Anything the model reads can read it. Anything that logs the model logs it. A page that talks the model into repeating it can exfiltrate it. Virtual cards and tokens limit the damage with caps and merchant scopes. They don't change the shape.

One company has already broken it. [Agentcard's Vault](https://www.agentcard.sh) has the agent type a dummy number, pauses the request to the payment processor, asks you to approve on your phone, and substitutes the real card before the request leaves the device. The agent holds nothing that spends. That is secrets by reference. It's a service for companies that build agents, with a map of each processor's request format behind it. We wanted the version for one person on one Mac, where the card is filled into the form itself and the swap, the key, and the approval never leave the machine.

We think the shape is the problem. A card number is a credential built for a hand to hold and a person to type. An agent is not a hand. It should act on secrets by reference and never hold them.

## By reference

When the agent reaches a checkout form, it does not ask for the card. It says which fields are the card fields. The harness around the model has the card, encrypted, in one place that only one module can read. The model's whole contribution is "the number goes in this element, the expiry in that one, the security code in this one." The harness verifies the claim, fills the fields, and from that moment masks the card out of everything the model is shown.

The model never asks for the number because it has no tool that returns it. There is nothing to prompt-inject out of the context, because the context never had it.

The same idea already works for passwords: 1Password's Secure Agentic Autofill, with Browserbase. Payments are harder for three reasons.

**The secret is visible after you type it.** Card numbers sit in plaintext on most checkout pages. An agent that reads the screen after the fill reads the card. So the harness redacts the number, expiry, and CVC from every window read, screenshot, tool result, and log until the task ends.

**The model can be steered about where to type.** Text on a legitimate page can talk the model into naming the wrong field. So the harness checks each named field against the page itself, by role and accessible label, rather than trusting the model's claim.

**The model's report of where it is can't be trusted.** The merchant gate reads the tab's real URL from the browser, requires HTTPS, and requires a domain you actually chose. Each field's frame, and every frame above it, is gated the same way: the merchant's origin or a short list of known processors (Stripe, Shopify Payments, Adyen, Braintree, PayPal, Checkout.com), judged by the origins the browser process reports, never by what a frame says about itself.

## Who we're defending against

| Attacker | What they try | What stops it |
| --- | --- | --- |
| Injected text on a legitimate page | Talk the model into the wrong field or the wrong total | Field checks, and an approval that shows the real total |
| Lookalike or redirect domain | Move checkout onto a page the attacker controls | Merchant gate: real URL, HTTPS, a domain you chose |
| Hostile page that lies about its own fields | Label a hidden input "Card number" and post it elsewhere, or embed a real processor frame inside an ad | Merchant and frame gates, up the whole frame chain |
| The model's own tools turned against the vault | Read the encrypted blob or the Keychain key | Terminal and file tools refuse Buddy's data folder and Keychain reads outright |
| Anything that reads the screen after the fill | Pick the card up from the form, a screenshot, or a log | Redaction from the first keystroke until the task ends |
| Compromised merchant | Capture the card as the store receives it | Out of scope: the same risk as typing it yourself |

## The five checks

Buddy's `fill_payment` runs these in order. Each fails closed.

1. **Fields are what they claim.** Role and label verified against the element.
2. **The form hasn't moved.** Re-read before filling.
3. **The merchant and every field's frame are ones you chose.** HTTPS, real URL, your domain or a listed processor, for the frame and every frame above it.
4. **You approve, with the facts from the page.** Card, real host, order total, all read by the harness, never reported by the model.
5. **Nothing downstream sees the card.** Redaction on, screenshots withheld.

The fill happens only inside Buddy's own browser over CDP, so the card never touches the system clipboard. The card itself is one encrypted blob under a key in the macOS Keychain; exactly one module decrypts it.

## What this doesn't do

- **The store still sees your real card.** A virtual card is better against a breach on the merchant's side.
- **There is no hard dollar cap yet.** The total is shown to you before you approve; a harness-enforced cap is next.
- **Prompt injection is not solved.** The checks remove the card from the attack surface. They do not remove the agent from it. The approval is where you catch a wrong item or quantity.
- **One-time codes, passwords, and ID numbers stay with you.** The card is the only secret Buddy fills, and only on a checkout you approved.

## Break it

The design is public, the code is public (`src/main/payment/`), and the threat model is written down. If you can get a digit of a saved card into the model's context, into a log, or onto a page the user didn't choose, open an issue.

If it holds up, the pattern matters more than the app. We'd rather see secrets by reference in every agent than in one.

_Buddy is MIT licensed at github.com/Point-Click-Research/buddy._
