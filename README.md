# MACRO NATION

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
