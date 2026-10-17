# ADR 0013: The rubric checks shape, and a name is a question

Status: accepted, 2026-10-16. Supersedes the "or names" clause of [ADR 0011](0011-contributing-factors-and-review.md).

## Context

The rubric failed any postmortem or status update that mentioned a person from the case, so "r.ibarra rolled back the approved config" read as blame. Blameless means explaining the conditions that made a step reasonable, not removing every actor. Its notes also claimed more than regexes can know: "a stranger could follow it" passed for three identical `00:00 x` lines.

## Decision

Blame vocabulary still fails automatically. A case person's name adds a self-check that asks whether the sentence explains a condition or points at someone. The notes name what they check (timestamps, a number, a type) and the review says it does not judge truth or clarity; filing closes the exercise and certifies nothing.

## Alternatives

Keep failing on names: simple, but it teaches anonymizing instead of blamelessness. Judge the text with an LLM: ruled out by ADR 0011 for the standalone course.

## Consequences

A blaming sentence that uses a name and no listed term passes the automatic checks; the self-check is the only guard for it.
