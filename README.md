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
npm run lint
npm test
npm run build
```

## Docs
- `docs/ARCHITECTURE.md`, `docs/ACCOUNTING.md` (formulas and rules), `docs/DATABASE.md` (schema, migrations)
- `docs/ANDROID.md` (build the APK, signing, install), `docs/UPDATING.md` (update without losing data)
- `docs/BACKUP.md`, `docs/GITHUB.md`, `docs/OWNER_GUIDE_AR.md` (simple Arabic guide for the owner)

## Invoice export (PDF / PNG / WhatsApp)
Open any sale or purchase invoice and use the buttons under the receipt.
- The receipt is drawn on a canvas with the bundled Cairo font, so Arabic shaping is done by the browser. PNG is that image; PDF embeds it as one page (text is not selectable).
- Android app: opens the system share sheet; choose WhatsApp, then the contact. Apps cannot pre-select a WhatsApp contact for an image.
- Browser (dev): uses the browser share sheet if it supports files; otherwise downloads the PNG and opens WhatsApp (the customer's/supplier's chat if a phone is saved, otherwise the contact picker) so you can attach it.

## App lock (PIN)
Settings > قفل التطبيق. The PIN is stored only as a salted PBKDF2-SHA256 hash, with an increasing delay after 5 wrong attempts, and the app locks again after 30 s in the background.
It is a privacy barrier, not encryption of the data file. The PIN is never written to backup files, and restoring a backup keeps the current PIN.
Biometric unlock is planned for the Android phase (native plugin needed).

## What has and has not been verified
Verified by automated tests (`npm test`): money/ledger/stock/report logic, SQLite persistence and migrations (sql.js), atomic transactions and rollback,
backup/restore (plain and encrypted), PIN hashing and lockout, UI flows in a simulated browser (jsdom), receipt/statement/report rendering to PNG/PDF (also inspected visually).
**NOT verified (needs your device):** layout and fonts in a real browser or phone, native Android SQLite persistence (Capacitor plugin), share sheet / WhatsApp,
biometric unlock, edge-to-edge insets on Android 15, and the APK build itself. See the first-run checklist in `docs/ANDROID.md`.

## Known limitations
- PDFs are images (Arabic text is not selectable). Long invoices are one tall page; statements and reports are A4 pages.
- Apps cannot pre-select a WhatsApp contact for an image: the share sheet opens and you choose WhatsApp, then the contact.
- Automatic backups run only while the app is open; they stay on the phone. Backups are encrypted only if a passphrase is entered.
- The PIN lock is a privacy barrier, not data encryption.
- Optional expenses module and barcode scanning are not included (not required).
- Payments to settle returns (refund cash to a customer) are not a separate flow: the credit stays on the account.
