# Database schema and migrations

SQLite. Money is stored as integer piasters, quantities as integer milli-units of the product's base unit. Source of truth: `src/db/migrations/*.sql` (applied in order; the runner records versions in `schema_migrations`).

| Table | Purpose |
|---|---|
| `settings` | key/value (business name, counters `seq:S`, flags). `pin_*` keys = app lock (never backed up) |
| `categories`, `units`, `products`, `product_units` | catalogue; `product_units.factor_to_base` converts any unit to the product's base unit |
| `parties` | customers and suppliers (`kind`), archived instead of deleted |
| `invoices`, `invoice_lines` | sales and purchases; lines keep their own price/discount/cost (`cost_total`) so later price edits never change history |
| `payments`, `payment_allocations` | cash received/paid; each allocation has a `kind`: `invoice`, `opening` (balance carried in), or `advance` (unapplied credit) |
| `returns`, `return_lines` | customer and supplier returns linked to invoice lines |
| `stock_movements` | every stock change (signed); stock = SUM per product |
| `ledger_entries` | every party balance change (signed); balance = SUM per party |
Reversals are new rows with `reverses_id`; cancelled documents keep their row and get `cancelled_at`.

Indexes: ledger by (party, date), stock movements by (product, date), invoices by (party, date), payments by (date, direction), allocations by invoice, return lines by invoice line.

Migrations: `001_init.sql` (core schema), `002_phase3.sql` (negative-stock flag, replacement link, line cost, return-line linkage), `003_allocation_kind.sql` (allocation kinds for oldest-bill-first payments).
Rules: append-only; every migration runs in a transaction and is rolled back on error; a database newer than the app is refused.
Accounting rules: see `ACCOUNTING.md`.
