# tawze3 — Phase 1 architecture

Stack: React + strict TS + Vite + Capacitor; SQLite via @capacitor-community/sqlite (Android) with its jeep-sqlite web adapter for browser dev; Recharts; pdfmake/pdf-lib with a bundled Arabic font + HarfBuzz-style shaping (to be verified by rendering a real PDF in Phase 4); Vitest.

Layers: `src/domain` (pure, tested) -> `src/db` (SQL + migrations, transactions) -> `src/services` (use-cases) -> `src/ui`.

Money = integer piasters; quantities = integer milli-units in the product's base unit.
Balance: >0 party owes us, <0 we owe party (customers and suppliers alike).
Corrections = reversal rows (`reverses_id`), never row edits. Stock and balances are sums over movements/ledger.
Metrics (src/domain/metrics.ts): actual = sales - purchases; ideal = sales + receivables - purchases - payables (closing balances at period end).
Backup: JSON/SQLite export + SHA-256 checksum + schema version, optional passphrase encryption (AES-GCM via WebCrypto), share sheet, pre-restore safety copy.
Android: `npm run build && npx cap sync android`, then Gradle `assembleRelease`; fixed appId, keystore kept outside repo.
