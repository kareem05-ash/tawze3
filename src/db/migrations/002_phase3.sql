-- Phase 3: negative-stock tracking, replacement links, cost tracking, return-line linkage.
ALTER TABLE invoices ADD COLUMN negative_stock_override INTEGER NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN replaces_id INTEGER REFERENCES invoices(id);
ALTER TABLE invoice_lines ADD COLUMN cost_total INTEGER;
ALTER TABLE return_lines ADD COLUMN invoice_line_id INTEGER REFERENCES invoice_lines(id);
ALTER TABLE return_lines ADD COLUMN qty_milli INTEGER;
CREATE INDEX idx_return_lines_invline ON return_lines(invoice_line_id);
CREATE INDEX idx_alloc_invoice ON payment_allocations(invoice_id);
CREATE INDEX idx_returns_invoice ON returns(invoice_id);
