# tawze3 — accounting rules implemented in Phase 3

- Money = integer piasters; quantities = integer milli-units of the product's base unit. Other units convert with `product_units.factor_to_base`.
- Balance (customers and suppliers): `> 0` the party owes you, `< 0` you owe the party. It is always `SUM(ledger_entries.delta)`; nothing stores a balance.
- Sale: ledger `+total`. Purchase: ledger `-total`. Receipt (customer pays): `-amount`. Payment (you pay supplier): `+amount`.
- An immediate payment on an invoice is a real payment row (so cash totals count it once) plus allocations: the part up to the invoice total is allocated to it, any excess is an unallocated advance.
- Invoice outstanding = total - returns - payments allocated to it (never below 0).
- **Payments are applied oldest bill first** (customers and suppliers alike). A party's open items are listed oldest first: the opening balance carried in from before the app (always the oldest), then invoices by date. A payment with no invoice chosen pays them in that order. Example: two 150 EGP invoices, 200 paid -> the older one is settled and the newer one shows 100 outstanding.
- Choosing an invoice (Pay from the invoice screen) pays that invoice first, then continues oldest-first.
- Money beyond everything owed is kept as unapplied credit (`advance` allocation); the next invoice absorbs it automatically, so a party never has credit and open bills at the same time. A return on a paid invoice frees the money in the same way.
- Cancelling an invoice: payments made only for it are cancelled with it (after confirmation); a payment that also paid other bills is kept and only this invoice's share becomes credit, which then pays the next oldest bill.
- A carried-in balance in the opposite direction (a customer who prepaid before the app) is shown in the balance only; it is not auto-applied to invoices.
- The party balance always comes from the ledger; settlement only decides which bills the money pays, and a randomized test checks after every operation that balance = open bills - unapplied credit.
- Returns are their own records linked to the invoice line: value is pro rata of the line's net price (including its share of the invoice discount); the last remainder takes the rounding residue. Customer returns re-enter stock only if usable; supplier returns need the goods in stock.
- Missing / lost / damaged stock: a stock movement only. Never a sale, never revenue.
- Cancel (void): rows are kept. Reversal rows (`reverses_id`) are added for stock and ledger, dated like the original, and `cancelled_at` is set, so cancelled documents drop out of totals, cash and balances for every date. Cancelling an invoice with payments requires `cancelPayments: true`. Invoices with returns cannot be cancelled. A purchase cannot be cancelled if that would make stock negative.
- Replace = cancel + post a corrected invoice in one transaction (`replaces_id` links them).
- Overselling is blocked by default; an explicit `allowNegativeStock` is stored as `invoices.negative_stock_override = 1`.
- Cost of sold goods (estimate): weighted average of all non-cancelled purchase lines (net of line discount) at posting time, stored per sale line as `cost_total`; `NULL` when there was no purchase history.
