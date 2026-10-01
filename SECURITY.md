# Security

Buddy's whole pitch is that the model never holds your card, your keys, or
your passwords. If you find a way around that, or any other vulnerability,
we want to hear about it privately first.

## Reporting

Use GitHub's private vulnerability reporting:
[github.com/Point-Click-Research/buddy/security/advisories/new](https://github.com/Point-Click-Research/buddy/security/advisories/new).
Please do not open a public issue for security bugs.

Include what you can: the steps to reproduce, which check you got past (see
[How the card stays out of the model](README.md#how-the-card-stays-out-of-the-model)),
and the Buddy version. We aim to acknowledge within three days and will
credit you in the fix unless you'd rather we didn't.

## In scope

- Any path by which a card number, API key, or password reaches a model,
  a transcript, a log, or a third party.
- Any way to fill a card into a frame that is not the merchant's or a
  listed processor's.
- Bypasses of the approval step before a purchase or a dangerous command.
- Agent mode doing something the user did not ask for and was not shown.

## Out of scope

- Behaviour of the model providers themselves (OpenRouter, Ollama, and the
  rest) once a request has legitimately left the machine.
- Anything that requires the attacker to already run code on the user's Mac.
