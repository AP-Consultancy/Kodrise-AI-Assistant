# AP AI Assistance Tool

Internal company desktop AI assistant (Electron + React + TypeScript).

## Current phase

Secure application foundation only:

- Electron main process
- Secure preload (`contextIsolation`, no `nodeIntegration`, `contextBridge`)
- React renderer shell
- Typed IPC smoke checks

AI, capture, and authentication are **not** implemented yet.

## Develop

```bash
npm install
npm start
```

## Scripts

| Script | Purpose |
|--------|---------|
| `npm start` | Run the Electron app in development |
| `npm run typecheck` | TypeScript checks for main, preload, and renderer |
| `npm run package` | Package the app |
| `npm run make` | Build installers |

## Security defaults

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- Preload exposes `window.companyAI` only
