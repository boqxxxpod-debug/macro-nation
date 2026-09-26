# MACRO NATION

## Optional AI explanations

The engine and ordinary news run without OpenAI, network access or an API key. The four optional operations are batched expert opinions, interpretation of a free-form policy into an **uncommitted candidate**, special economic news and post-game history. The existing UI is still a foundation shell; `AIControls` is an integration component for the upcoming policy, report and ending screens. It does not call an API on page load. `npm run dev` shows a clearly marked Mock preview with sample data; production builds omit it.

Use `VITE_AI_ENABLED=true` and `VITE_AI_PROVIDER=mock` plus the desired `VITE_AI_*_ENABLED=true` flags to exercise the client with no API charges. To use OpenAI, set `VITE_AI_PROVIDER=openai` and configure the matching server flags, `AI_PROVIDER=openai`, `OPENAI_MODEL=gpt-6-luna` and `OPENAI_API_KEY` in **server-only** settings. Do not prefix secrets with `VITE_`. Build with `npm run build:xserver`. See [Xserver setup](deploy/xserver/README.md). An omitted server or key affects only optional calls.

The [architecture](docs/04-architecture.md), [game specification](docs/05-game-specification.md) and [detailed design](docs/03-detailed-design.md) describe the engine/AI boundary and the `/api/ai.php` contract.

Browser-based nation-management macroeconomic simulation game.

Issue #1 establishes the implementation foundation: npm workspaces, a React/Vite/TypeScript PWA shell, a headless Simulation Engine boundary, Xserver deployment scaffolding, and CI quality gates.

## Requirements

- Node.js 22.12+ (see `.nvmrc`)
- npm

## Workspace

```text
apps/web
packages/domain
packages/simulation-engine
packages/model-config
packages/advisor-core
```

The Simulation Engine is Pure TypeScript. It must not depend on React, DOM, IndexedDB, wall-clock time, or `Math.random`.

## Start development

```bash
npm install
npm run dev
```

## Headless SCN-01 simulation

Run the no-policy SCN-01 baseline from Node with the same monthly engine used by the app:

```bash
npm run simulate -- --ticks 48 --seed baseline-48
npm run simulate -- --ticks 96 --seed baseline-96
npm run simulate:batch:10
npm run simulate:1000
npm run simulate -- --replay artifacts/headless/48x1-baseline-48/replay-package.json
```

The runner writes `summary.json`, `strategy.csv`, `invariant-failures.json`, `run-failures.json`, and a self-contained `replay-package.json` to `artifacts/headless/` by default. Pass `--out <directory>` to choose another output location. The 1,000-run command executes 96 monthly ticks per seed and exits with a failure status if any seed fails. CI smoke uses the fixed golden seed to check the runner; `simulate:batch:10` and `simulate:1000` check behavior across distinct seeds.

The current ConfigPack does not define initial tax/spending bases, external-debt share, or sector import exposure. The runner therefore starts with a balanced primary budget, domestically held public debt, and the configured aggregate import share for each sector; these are explicit bootstrap defaults, not empirical calibration claims.

## Verify the entire foundation

From a clean checkout, the project can install dependencies and run all non-browser quality gates with one command:

```bash
npm run bootstrap
```

After dependencies are installed, use:

```bash
npm run verify
```

This runs formatting checks, ESLint, TypeScript checks, unit tests, architecture-boundary checks, the production build, and root/subdirectory base-path build smoke tests.

The browser/PWA acceptance tests are:

```bash
npx playwright install chromium
npm run test:e2e
```

## Xserver build

Root deployment:

```bash
npm run build:xserver
```

Subdirectory example:

```bash
VITE_BASE_PATH=/macro-nation/ XSERVER_BASE_PATH=/macro-nation/ npm run build:xserver
```

The deploy helper writes the SPA fallback `.htaccess` into `apps/web/dist/`.

See `deploy/xserver/README.md` and the specifications under `docs/`.

## GitHub Pages preview

The playable browser-only game can be published at
`https://boqxxxpod-debug.github.io/macro-nation/`. Enable GitHub Pages with
**GitHub Actions** as its publishing source in the repository's Settings → Pages.
The `Deploy GitHub Pages` workflow builds and deploys on pushes to `main` or
when run manually. It uses the `/macro-nation/` base path and a `404.html`
fallback for direct visits to game routes. It intentionally does not include
the Xserver PHP API; optional OpenAI explanations remain disabled. Saves are
local to the browser and origin, so an Xserver save will not appear on Pages.

To inspect the artifact locally, run
`VITE_BASE_PATH=/macro-nation/ VITE_AI_ENABLED=false npm run build:pages`.

## Pull request merge flow

The [`CI` workflow](.github/workflows/ci.yml) runs its `verify` job for every pull request. The default-branch ruleset requires that check to pass. Enable GitHub auto-merge on an individual PR to merge it when all required checks pass. Codex automatic review posts feedback separately; it is not a required check, so its feedback can arrive after a fast CI run. A merge to `main` triggers the [GitHub Pages deployment workflow](.github/workflows/pages.yml).
