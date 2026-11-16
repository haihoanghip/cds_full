CREATE TABLE orders (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  buyer_email TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  payment_method TEXT NOT NULL DEFAULT 'cod' CHECK (payment_method = 'cod'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'shipping', 'delivered', 'cancelled')),
  subtotal_vnd INTEGER NOT NULL CHECK (subtotal_vnd >= 0),
  shipping_fee_vnd INTEGER NOT NULL DEFAULT 0 CHECK (shipping_fee_vnd >= 0),
  total_vnd INTEGER NOT NULL CHECK (total_vnd >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE order_items (
  id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id_snapshot TEXT NOT NULL,
  product_name TEXT NOT NULL,
  unit_price_vnd INTEGER NOT NULL CHECK (unit_price_vnd >= 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0)
);

CREATE INDEX idx_orders_status_created ON orders(status, created_at DESC);
CREATE INDEX idx_orders_user_created ON orders(user_id, created_at DESC);
CREATE INDEX idx_order_items_order ON order_items(order_id);
