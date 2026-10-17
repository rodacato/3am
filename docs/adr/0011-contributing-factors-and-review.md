# ADR 0011: Contributing factors, a fixed rubric, LLM only through the host

Status: accepted, 2026-10-16. Names in the rubric superseded by [ADR 0013](0013-rubric-checks-shape-not-truth.md).

## Context

The course should teach blameless analysis, and stay usable with no AI at all.

## Decision

Cases define several contributing factors (trigger, condition, latent) and distractors; the postmortem asks the reader to pick every factor, never one root cause. The standalone review is a deterministic rubric (`src/engine/rubric.ts`): timestamps in the timeline, numbers in the impact, factors matched, no blame vocabulary or names (per-locale term lists), typed and owned action items. Scoring reports method: time to stable, users affected, detour minutes, evidence backing each factor, hypotheses held and dropped.

## Consequences

An LLM evaluation can only arrive through the host bridge after the case is closed, consistent with Dojo's honor code.
