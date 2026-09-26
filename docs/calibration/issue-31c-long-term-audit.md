# Issue #31-C long-term calibration audit

Audit date: 2026-09-26

Base commit: `dce1f5e45c8d37e85dbfa798ba072be3b47906eb`

## Reproduction

```sh
npm run simulate:30y:100
```

The command writes `summary.json`, `strategy.csv`, `crisis-stops.json`, invariant
and run failure lists, plus a self-contained representative replay package under
`artifacts/headless/100x360/`. Each crisis row contains its seed, first stopped
month, Config hash, and a one-run reproduction command. The artifact directory is
intentionally ignored by Git because a report must be regenerated from the
reviewed Engine and Config rather than accepted as an unexplained golden update.

## Result on the audited base

| Gate | Result |
| --- | --- |
| Config identity | `f06aaa63b17e6a0370dc4bddf5e6cf16f7110b3a144012cdf9bb59e208353796` |
| Engine / model / calibration | `0.1.9` / `0.1.2` / `advanced-small-open-v1.0.0` |
| NaN, Infinity, invariant, contribution, or tick failures | 0 / 100 runs |
| Completed 360 months | 2 / 100 runs |
| Crisis-stopped | 98 / 100 runs |
| First crisis deviation | seed `issue-31c-long-term-v1-0001`, month 71 |
| Debt-ratio final range | 0.4925633795 to 104.3349452961 |
| Inflation final range | -0.10 to 0.2165888911 |

The 98% crisis-stop rate means the “no crisis fixed-state / long-term completion”
gate is not demonstrated. The debt and inflation tails also need approved
long-term target bands before they can be marked pass or fail. No coefficient,
crisis threshold, or golden fixture is changed by this audit.

## Gate disposition

- **Pass:** deterministic Config identity is recorded; all executed ticks satisfy
  state and causal-contribution invariants; no numeric or progress failure occurs.
- **Blocked:** acceptable crisis frequency, debt tail, inflation tail, business
  cycle length, and financial cycle length do not yet have machine-readable target
  bands in `calibrationTargets.json`.
- **Fail on current candidate:** only 2% of no-policy ultra-long runs reach month
  360 before the game-mode crisis stop, so Issue #31-C and Issue #16 remain open.

The next model-only calibration PR must add sourced target bands and report these
five gates separately. It must not weaken Engine invariants or silently update an
existing golden fixture.
