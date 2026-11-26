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

## Invoice export (PDF / PNG / WhatsApp)
Open any sale or purchase invoice and use the buttons under the receipt.
- The receipt is drawn on a canvas with the bundled Cairo font, so Arabic shaping is done by the browser. PNG is that image; PDF embeds it as one page (text is not selectable).
- Android app: opens the system share sheet; choose WhatsApp, then the contact. Apps cannot pre-select a WhatsApp contact for an image.
- Browser (dev): uses the browser share sheet if it supports files; otherwise downloads the PNG and opens WhatsApp (the customer's/supplier's chat if a phone is saved, otherwise the contact picker) so you can attach it.

## App lock (PIN)
Settings > قفل التطبيق. The PIN is stored only as a salted PBKDF2-SHA256 hash, with an increasing delay after 5 wrong attempts, and the app locks again after 30 s in the background.
It is a privacy barrier, not encryption of the data file. The PIN is never written to backup files, and restoring a backup keeps the current PIN.
Biometric unlock is planned for the Android phase (native plugin needed).
