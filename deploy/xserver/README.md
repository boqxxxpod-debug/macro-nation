# Xserver deployment

Issue #1 keeps deployment static and backend-free.

## Root deployment

```bash
npm install
npm run build:xserver
```

Upload the contents of `apps/web/dist/` to the document root.

## Subdirectory deployment

For example, when publishing at `https://example.com/macro-nation/`:

```bash
VITE_BASE_PATH=/macro-nation/ XSERVER_BASE_PATH=/macro-nation/ npm run build:xserver
```

Upload the contents of `apps/web/dist/` to the matching `macro-nation/` directory.

The generated `.htaccess` provides SPA fallback. Xserver-specific configuration stays in this directory and never enters the Simulation Engine.

## Optional AI proxy

`npm run build:xserver` stages `dist/api/ai.php` plus its versioned prompts and pricing file. This endpoint is unnecessary for the offline game. Configure PHP **8.1 or later**, cURL and mbstring on the target host; verify the exact Xserver plan before enabling. All prompts/prices live under `api/_private/`, denied by its `.htaccess`; check that fetching any path under `_private/` returns HTTP 403 on your deployed site.

Set server-only `AI_ENABLED`, `AI_PROVIDER` (`mock` or `openai`), `AI_ADVISORS_ENABLED`, `AI_FREE_POLICY_ENABLED`, `AI_NEWS_ENABLED`, `AI_NATION_HISTORY_ENABLED`, `OPENAI_MODEL`, `OPENAI_API_KEY`, and `AI_DATA_DIR`. Set build-time `VITE_AI_ENABLED`, `VITE_AI_PROVIDER`, and the corresponding `VITE_AI_*_ENABLED` flags independently. Flags must equal the literal `true` to enable. The model ID verified in the official OpenAI model catalog is `gpt-6-luna`; no model fallback occurs.

If the hosting control panel does not inject PHP environment variables, create a PHP file named `macro-nation-ai-config.php` in the **parent of DocumentRoot**, returning an associative array of those server-only setting names and their string values. This file must remain outside the web root, git and uploaded `dist`. Example contents, with a placeholder that must be replaced privately:

```php
<?php
return [
  'AI_ENABLED' => 'true',
  'AI_PROVIDER' => 'openai',
  'AI_NEWS_ENABLED' => 'true',
  'OPENAI_MODEL' => 'gpt-6-luna',
  'OPENAI_API_KEY' => '<private-key>',
  'AI_DATA_DIR' => '/absolute/non-public/writable/directory',
];
```

Create `AI_DATA_DIR` outside DocumentRoot and make it writable by PHP. It holds `limits-YYYY-MM-DD.json`, an exclusive `ai.lock`, and `usage-YYYY-MM-DD.jsonl`. Daily usage records include feature, model, token counts (including cached and cache writes), latency, success, error and estimated USD cost. Prices in `api/_private/prices.json` are per 1M tokens and should be refreshed when pricing changes. Default limits: 5 requests per IP/feature/hour, 100 requests/day globally, and $1 estimated/day; one concurrent request at a time, 8 KiB body, 10 second upstream timeout. Optional overrides are `AI_PER_IP_FEATURE_HOUR`, `AI_DAILY_REQUEST_LIMIT`, `AI_DAILY_COST_USD`. Also configure OpenAI project spend limits to bound real billing independently.

Test `POST /api/ai.php` with Mock before switching to OpenAI. A disabled feature returns 403 or 503 and the client falls back. Confirm PHP receives the environment or private file, `_private` is inaccessible, logs are non-public, and no API key appears in the browser network response. This PHP endpoint has not been runtime-verified by the repository test suite when local PHP is absent; test it on a staging Xserver environment before public activation.
