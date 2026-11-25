# tawze3 (توزيع)

Offline Arabic RTL business app for a small distributor: stock, purchases, sales, customer/supplier accounts, payments, returns.
React + strict TypeScript + Vite + Capacitor + SQLite.

## Run in the browser (development)
```bash
npm install
npm run dev          # open http://localhost:5173
```
Browser mode stores the database (SQLite via WebAssembly) in this browser's IndexedDB, so data survives reloads.
For a clean slate: DevTools > Application > Storage > Clear site data.

## Checks
```bash
npm run typecheck
npm test
npm run build
```

## Docs
- docs/ARCHITECTURE.md, docs/ACCOUNTING.md
- Android packaging, backup/restore and the Arabic owner guide come in later phases.
