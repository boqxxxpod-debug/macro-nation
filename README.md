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
