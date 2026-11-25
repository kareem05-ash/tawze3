CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, archived INTEGER NOT NULL DEFAULT 0);
CREATE TABLE units (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE products (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT, notes TEXT,
  category_id INTEGER REFERENCES categories(id), base_unit_id INTEGER NOT NULL REFERENCES units(id),
  buy_price INTEGER NOT NULL DEFAULT 0, sell_price INTEGER NOT NULL DEFAULT 0,
  low_stock_milli INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0);
CREATE TABLE product_units (product_id INTEGER NOT NULL REFERENCES products(id), unit_id INTEGER NOT NULL REFERENCES units(id),
  factor_to_base REAL NOT NULL CHECK (factor_to_base > 0), PRIMARY KEY (product_id, unit_id));
CREATE TABLE parties (id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('customer','supplier')),
  name TEXT NOT NULL, phone TEXT, address TEXT, notes TEXT, archived INTEGER NOT NULL DEFAULT 0);
CREATE TABLE invoices (id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('sale','purchase')),
  ref TEXT NOT NULL UNIQUE, party_id INTEGER NOT NULL REFERENCES parties(id), date TEXT NOT NULL,
  subtotal INTEGER NOT NULL, discount INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL,
  notes TEXT, external_ref TEXT, cancelled_at TEXT);
CREATE TABLE invoice_lines (id INTEGER PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  product_id INTEGER NOT NULL REFERENCES products(id), unit_id INTEGER NOT NULL REFERENCES units(id),
  qty_milli INTEGER NOT NULL CHECK (qty_milli > 0), base_qty_milli INTEGER NOT NULL,
  unit_price INTEGER NOT NULL, line_discount INTEGER NOT NULL DEFAULT 0, line_total INTEGER NOT NULL,
  unit_cost_at_sale INTEGER);
CREATE TABLE payments (id INTEGER PRIMARY KEY, ref TEXT NOT NULL UNIQUE, party_id INTEGER NOT NULL REFERENCES parties(id),
  direction TEXT NOT NULL CHECK (direction IN ('in','out')), amount INTEGER NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL DEFAULT 'cash', date TEXT NOT NULL, notes TEXT, cancelled_at TEXT);
CREATE TABLE payment_allocations (payment_id INTEGER NOT NULL REFERENCES payments(id),
  invoice_id INTEGER REFERENCES invoices(id), amount INTEGER NOT NULL CHECK (amount > 0));
CREATE TABLE returns (id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('customer','supplier')),
  ref TEXT NOT NULL UNIQUE, invoice_id INTEGER REFERENCES invoices(id), party_id INTEGER NOT NULL REFERENCES parties(id),
  date TEXT NOT NULL, total INTEGER NOT NULL, notes TEXT);
CREATE TABLE return_lines (id INTEGER PRIMARY KEY, return_id INTEGER NOT NULL REFERENCES returns(id),
  product_id INTEGER NOT NULL REFERENCES products(id), base_qty_milli INTEGER NOT NULL CHECK (base_qty_milli > 0),
  unit_price INTEGER NOT NULL, line_total INTEGER NOT NULL, usable INTEGER NOT NULL DEFAULT 1);
CREATE TABLE stock_movements (id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id),
  type TEXT NOT NULL, base_qty_milli INTEGER NOT NULL, date TEXT NOT NULL, reason TEXT, notes TEXT,
  source_table TEXT, source_id INTEGER, reverses_id INTEGER REFERENCES stock_movements(id));
CREATE TABLE ledger_entries (id INTEGER PRIMARY KEY, party_id INTEGER NOT NULL REFERENCES parties(id),
  type TEXT NOT NULL, delta INTEGER NOT NULL, date TEXT NOT NULL, source_table TEXT, source_id INTEGER,
  reverses_id INTEGER REFERENCES ledger_entries(id));
CREATE INDEX idx_ledger_party_date ON ledger_entries(party_id, date);
CREATE INDEX idx_moves_product ON stock_movements(product_id, date);
CREATE INDEX idx_invoices_party_date ON invoices(party_id, date);
CREATE INDEX idx_payments_date ON payments(date, direction);
