# AGENTS.md — MACRO NATION

## Purpose

This repository implements **MACRO NATION**, a browser-based nation-management macroeconomic simulation game.

Before implementing or modifying a feature, read the relevant documents under `docs/`. Do not treat an Issue body alone as the complete specification.

## Source of truth by domain

There is no single global precedence order. Resolve conflicts by domain:

1. **Technical architecture, dependency direction, deployment, versioning, persistence boundaries**
   - `docs/04-architecture.md`
2. **Game behavior, player-facing rules, time progression, policies, events, experts, education, Living Nation, completion behavior**
   - `docs/05-game-specification.md`
3. **Implementation structure, modules, types, processing order, interfaces, save contracts, test mapping**
   - `docs/03-detailed-design.md`
4. **Product requirements and acceptance criteria**
   - `docs/02-requirements.md`
5. **Economic model calibration / parameter pack**
   - `docs/06-economic-model-parameters.md`
   - If this file is marked BLOCKED or incomplete, do **not** invent empirical coefficients. Use only model structure already defined in the architecture, game specification, and detailed design, and keep coefficients configurable.
6. **Product intent and experience goals**
   - `docs/01-product-plan.md`
7. **Implementation sequencing**
   - `docs/07-implementation-roadmap.md`

When two documents conflict inside the same domain, prefer the more specific specification and report the conflict in the implementation summary rather than silently choosing a new behavior.

## Architecture invariants

- Deployable to Xserver as a static SPA/PWA.
- MVP has no login, no cloud save, and no server-side continuous simulation.
- Use npm workspaces with reusable domain/simulation/model/advisor packages as specified in the architecture.
- Simulation Engine must remain **Pure TypeScript** and independent of React, DOM, IndexedDB, browser clock, and `Math.random`.
- Randomness must be seeded and reproducible.
- Engine behavior must be deterministic for the same versions, config, state, seed, and command sequence.
- Economic coefficients, lags, thresholds, event probabilities, initial values, text/content, and nation-specific values must be data-driven and externally configurable.
- Do not hard-code nation-specific branches in the simulation engine.
- Persistence must be behind repository/adapter boundaries.
- Experts/advisors may explain or evaluate the same engine result but must not secretly alter economic outcomes.
- Game explanations, policy preview, experts, education views, Nation Voice, and history should derive from the same causal/result data instead of separate hidden calculations.
- Engine, model/config, save schema, content, and RNG versions must be independently versionable where specified.

## Development workflow for every Issue

1. Read the Issue.
2. Read `docs/00-document-index.md`.
3. Read all specification files relevant to the Issue.
4. Inspect existing implementation and tests before changing code.
5. Implement the smallest coherent vertical slice that satisfies the Issue.
6. Add or update automated tests in the same change.
7. Run tests, type checks, lint, and production build when available.
8. For simulation changes, verify deterministic/headless execution.
9. For persistence changes, verify save compatibility/migration rules.
10. Summarize:
   - implemented requirement(s),
   - docs/sections consulted,
   - tests added/run,
   - any specification conflicts or unresolved assumptions.

## Publishing changes from ChatGPT WORK

- Prefer the repository's connected GitHub integration for remote writes. A workstation, local GitHub login, or user-supplied Personal Access Token is not required when the connected integration has access.
- Before publishing, verify the repository name, default branch, current remote base, connector identity/permissions, applicable branch rules, CI workflow, and the local diff. Do not infer that branch protection is absent when the available integration cannot inspect it.
- Use a task branch unless the repository's documented workflow says otherwise. Apply the reviewed file changes through the connected GitHub integration, create a commit, and open a pull request to the verified default branch. Keep the pull request scoped and describe any bundled, previously unmerged Issue work.
- If local `git push` or `gh auth` is unavailable, continue with the connected GitHub integration's blob/tree/commit/ref and pull-request operations when available; do not request a pasted token. If repository access is missing, report the exact repository and missing permission, then give the owner the GitHub App repository-access path needed to grant it.
- Do not merge automatically unless an existing repository instruction explicitly authorizes it. Report the branch, commit SHA, pull-request URL, tests, and CI result. If a connector capability is missing, state what was verified and what remains blocked.

## Economic-model guardrails

- Do not change economic assumptions merely to make tests pass.
- Do not replace lagged effects with immediate UI-only effects.
- Do not bypass causal logging.
- Do not tune coefficients in UI components.
- Keep model tuning separable from engine logic so model-only changes can be reviewed independently.
- Until `docs/06-economic-model-parameters.md` contains a complete approved calibration pack, avoid claiming empirical realism for numeric coefficients not already specified elsewhere.

## Completion standard

A feature is not complete merely because the screen renders. It must preserve deterministic simulation, configuration boundaries, causal explainability, save consistency, and relevant acceptance tests.
