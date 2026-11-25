# tawze3 — accounting rules implemented in Phase 3

- Money = integer piasters; quantities = integer milli-units of the product's base unit. Other units convert with `product_units.factor_to_base`.
- Balance (customers and suppliers): `> 0` the party owes you, `< 0` you owe the party. It is always `SUM(ledger_entries.delta)`; nothing stores a balance.
- Sale: ledger `+total`. Purchase: ledger `-total`. Receipt (customer pays): `-amount`. Payment (you pay supplier): `+amount`.
- An immediate payment on an invoice is a real payment row (so cash totals count it once) plus allocations: the part up to the invoice total is allocated to it, any excess is an unallocated advance.
- Invoice outstanding = total - returns - payments allocated to it (never below 0; excess is shown as credit). A payment with no invoice reduces the party balance only.
- Returns are their own records linked to the invoice line: value is pro rata of the line's net price (including its share of the invoice discount); the last remainder takes the rounding residue. Customer returns re-enter stock only if usable; supplier returns need the goods in stock.
- Missing / lost / damaged stock: a stock movement only. Never a sale, never revenue.
- Cancel (void): rows are kept. Reversal rows (`reverses_id`) are added for stock and ledger, dated like the original, and `cancelled_at` is set, so cancelled documents drop out of totals, cash and balances for every date. Cancelling an invoice with payments requires `cancelPayments: true`. Invoices with returns cannot be cancelled. A purchase cannot be cancelled if that would make stock negative.
- Replace = cancel + post a corrected invoice in one transaction (`replaces_id` links them).
- Overselling is blocked by default; an explicit `allowNegativeStock` is stored as `invoices.negative_stock_override = 1`.
- Cost of sold goods (estimate): weighted average of all non-cancelled purchase lines (net of line discount) at posting time, stored per sale line as `cost_total`; `NULL` when there was no purchase history.
