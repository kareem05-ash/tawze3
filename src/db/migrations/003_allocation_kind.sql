-- Phase 5: payments are applied oldest-bill-first. Each allocation says what it pays:
--   'invoice' (invoice_id set), 'opening' (the balance carried in before using the app), 'advance' (unapplied credit).
ALTER TABLE payment_allocations ADD COLUMN kind TEXT NOT NULL DEFAULT 'advance';
UPDATE payment_allocations SET kind = 'invoice' WHERE invoice_id IS NOT NULL;
CREATE INDEX idx_alloc_payment ON payment_allocations(payment_id);
