# Economic model parameters — synchronization status

> Source: Macro_Nation_Economic_Model_Parameters_v1.0
> Checked: 2026-09-22
> Status: **BLOCKED — source document has no body content**

The Google Drive source exists, but its document body is empty. No coefficient table, lag table, correlation calibration, or parameter definitions were available to synchronize safely.

## Temporary implementation rule

Until an approved calibration pack is restored:

- Use `04-architecture.md` for model/config boundaries and determinism requirements.
- Use `05-game-specification.md` for required game behavior and policy transmission semantics.
- Use `03-detailed-design.md` for ConfigPack structure, simulation processing order, ScheduledEffect handling, causal logging, and tests.
- Keep coefficients, lags, thresholds, probabilities, and nation-specific values external to UI and engine logic.
- Do **not** invent values and present them as empirically validated.
- Any provisional test fixture values must be clearly labeled as test/default tuning values and remain replaceable without engine-code changes.

## Recovery note

Earlier project work established the intended direction: monthly deterministic simulation; seeded RNG; lagged scheduled effects; household consumption, business investment, government spending, trade/GDP, CPI/import prices/wages, unemployment/employment lags, fiscal/debt dynamics, FX/capital flows/reserves, real income/trust/political capital, six industries, infrastructure/potential GDP, and explicit NaN/Infinity/bounds tests. The detailed design remains the implementation reference for those structures until this parameter document is restored.
