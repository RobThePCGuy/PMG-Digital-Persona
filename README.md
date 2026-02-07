# PMG Digital Persona (Post-Mortem-Governed Digital Personas)

A design memo + spec site for building *trustworthy* “digital persona” systems after someone dies.

This is not “bringing someone back.”
It’s a governed simulation constrained by an archived body of artifacts, with explicit consent, time delays, and auditability as first-class features.

## What this proposes (in one breath)
A privacy-first, consent-first architecture for post-mortem digital personas where:
- Access is **time-delayed** by default (cooling period)
- Release requires **multi-party trustee quorum** (no single point of unlock)
- Outputs are **citation-bound** to archived artifacts (or the system abstains)
- Every meaningful event is **logged** in a tamper-evident way
- Identity and authorization are **standards-based** (DIDs / Verifiable Credentials style thinking)

## Why
Most “memorial bots” feel powerful but aren’t trustworthy. This project treats *boundaries* as the product:
- If it can’t cite, it shouldn’t speak.
- If policy says “no,” nobody gets to override it quietly.
- If something smells off, a single trustee can suspend; resuming requires a quorum.

## Read it (the site)
This repository is a static spec site (GitHub Pages). Start at the homepage and follow the sections:
- Glossary (shared vocabulary)
- Lifecycle (state machine)
- Governance (roles, thresholds, deadlocks)
- Citation Binding (how claims get tied to sources)
- Ambiguity Ledger (design decisions + tradeoffs)
- Spec Graph (how pages relate)

## What’s in this repo
- Static HTML/CSS/JS for the spec site
- Supporting pages + a visual “spec graph” view

## Status
Concept / design exploration. This is a spec meant to provoke good engineering and careful debate—not a finished product.

## Contributing
Issues and PRs welcome, especially:
- Threat model improvements (attacks we missed)
- Governance edge cases (deadlocks, trustee loss, disputes)
- Better “abstention UX” patterns (how refusal stays humane)
- Clearer definitions in the glossary / ambiguity ledger

## Principles (non-negotiables)
- No deception mode (it must not pretend to be the person)
- No financial/identity acts
- No unsourced claims
- No silent overrides
