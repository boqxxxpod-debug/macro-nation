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
