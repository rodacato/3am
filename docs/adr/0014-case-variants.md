# ADR 0014: A case has variants with different root causes

Status: accepted, 2026-10-28.

## Context

Replaying a case changed only the noise: the same bug, the same fix. A reader who closed case 01 once
could close it again from memory. The engine also had two gaps that a cause other than a config
change would expose: a mitigation that only quiets the alert for five minutes counted as stable, and
rate-based logs kept firing after the mitigation that removed their effect.

## Decision

- **A case declares `variants`.** They share the city: components, traffic, alert, page, tools,
  briefing and the stakeholder. Each variant replaces `changes`, `effects`, `config`, `mitigations`,
  `factors`, `distractorFactors`, `causalChain`, `solution` and the debrief note, and adds `logs` to
  the case's shared ones. A case without variants is one implicit variant.
- **The seed picks the variant**: `index = (seed - 1) mod n`, so seed 1 is the first variant.
  Progress, sessions and Dojo units stay per case.
- **A variant must not give itself away.** Every variant has the same kinds of changes and the same
  set of mitigations, so the change log and the actions panel look alike. Each variant's real factors
  appear as distractors in the others.
- **Coupling is authored, not simulated.** CPU and memory are metrics only; a variant that needs
  "saturated, then slow" pairs a `cpu` or `memoryMb` effect with a latency or error effect on the
  same window, with the same `removedBy` and `resetBy`. Load-dependent latency stays planned for
  case 05.
- **Stable means it stays quiet.** After five quiet minutes, the alert's condition must not be true
  again for the rest of the watch window. A restart that only resets a leak is not a fix.
- **A rate log that follows an effect emits only while that effect is active**, honouring
  `removedBy`, `resetBy` and its window.

## Alternatives

- Same cause, different surface (services, times, names): cheaper, but a reader recognises the pattern.
- The reader picks the variant: gives away that there are several causes before the night starts.
- Load-dependent latency now: real coupling, but it changes every existing case's numbers and is the
  work case 05 already plans.

## Consequences

`check:solvable` and the unit tests iterate every variant, not just a set of seeds. The e2e tests pin
a seed per variant. Variant text lives in the case's own locale files under a `variant.<id>.` prefix,
except mitigation text, which stays under `mitigation.<id>.` with an id unique across variants, and
`check:i18n` walks every variant's keys.

Variant D of case 01 (a memory leak) pairs memory with a latency effect that starts later, so after
a restart latency returns sooner than memory would explain. Load-dependent latency fixes that.
