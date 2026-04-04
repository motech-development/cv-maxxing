# Task PRDs

These PRDs are the board-ready implementation units derived from [ARCHITECTURE.md](/Users/mo/Repos/motech-development/cv-maxxing/ARCHITECTURE.md).

## PRD Template

Each task file follows this contract:

- `Objective`: the concrete outcome to build
- `User Value`: why the outcome matters in product terms
- `Scope`: what the task owns
- `Non-Goals`: what the task must not absorb
- `Requirements`: implementation rules and constraints
- `Dependencies`: prerequisite PRDs or source documents
- `Acceptance Criteria`: definition of done for the task
- `Verification`: minimum automated or manual proof expected

## Suggested Board Order

1. `PRD-001` repo workspace scaffold
2. `PRD-002` quality tooling and script surface
3. `PRD-003` test harness and CI baseline
4. `PRD-004` Electron shell and secure process boundaries
5. `PRD-005` app-data paths and runtime config
6. `PRD-006` SQLite schema and persistence baseline
7. `PRD-007` first-launch and workspace shell UI
8. `PRD-008` source CV import pipeline
9. `PRD-009` canonical CV normalization
10. `PRD-010` writing-style profile generation
11. `PRD-011` source CV library management UX
12. `PRD-012` vacancy intake drafts and URL classification
13. `PRD-013` Greenhouse deterministic fetcher
14. `PRD-014` LinkedIn and Indeed browser-backed fetchers
15. `PRD-015` generic fallback fetcher and vacancy normalization
16. `PRD-016` Codex runtime adapter and run workspace
17. `PRD-017` Codex preflight, sign-in, and resumable generation
18. `PRD-018` tailoring pipeline and validation
19. `PRD-019` CV renderer, preview, and PDF export
20. `PRD-020` cover-letter generation, preview, and PDF export
21. `PRD-021` immutable package history, browsing, and regeneration UX
22. `PRD-022` hardening, failure reporting, and authenticated session management
23. `PRD-023` full UI and document design fidelity pass
24. `PRD-024` final system integration and release acceptance
