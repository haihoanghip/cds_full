import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";

const app = new Hono();
const encoder = new TextEncoder();
const SESSION_COOKIE = "shop_session";
const SESSION_SECONDS = 60 * 60 * 24 * 7;
const CATALOG_CACHE_KEY = "catalog:products:v1";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Map([
  ["image/jpeg", "jpg"], ["image/png", "png"],
  ["image/webp", "webp"], ["image/avif", "avif"],
]);

// ---- Ghi nhận lượt truy cập vào Cloudflare Pipelines stream (schema trong ketnoi/inpo.txt) ----
// Trường: id, country, device, time (timestamp, mili-giây), ip, meta (json)
function detectDevice(userAgent) {
  if (/ipad|tablet/i.test(userAgent)) return "tablet";
  if (/iphone|ipod/i.test(userAgent)) return "ios";
  if (/android/i.test(userAgent)) return /mobile/i.test(userAgent) ? "android" : "tablet";
  return "desktop";
}

async function sendVisitToStream(env, record) {
  if (!env.STREAM_URL) return;
  try {
    const headers = { "Content-Type": "application/json" };
    if (env.STREAM_TOKEN) headers.Authorization = `Bearer ${env.STREAM_TOKEN}`;
    // Stream HTTP ingest nhận một MẢNG các bản ghi JSON.
    const response = await fetch(env.STREAM_URL, { method: "POST", headers, body: JSON.stringify([record]) });
    if (!response.ok) console.warn("Stream ingest failed:", response.status, await response.text().catch(() => ""));
  } catch (error) {
    // Thống kê không được làm hỏng request chính.
    console.warn("Stream ingest error:", error);
  }
}

async function saveVisitLocally(env, visitId, record) {
  try {
    await env.APP_DB.prepare("INSERT INTO visits (id, country, device, time, ip, meta) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(visitId, record.country, record.device, record.time, record.ip, JSON.stringify(record.meta)).run();
  } catch (error) {
    console.warn("Local visit save error:", error);
  }
}

// Frontend gọi 1 lần mỗi phiên khi mở web => 1 lượt truy cập (không đếm từng API call).
app.post("/api/track", enforceSameOrigin, async (c) => {
  const userAgent = c.req.header("User-Agent") ?? "";
  if (!userAgent || /bot|crawl|spider|slurp|headless/i.test(userAgent)) return c.body(null, 204);
  const body = await c.req.json().catch(() => ({}));
  const visitId = crypto.randomUUID();
  const record = {
    // Stream dùng chung của giảng viên: id = tên nhóm (STREAM_GROUP_ID); mã lượt truy cập nằm trong meta.
    id: c.env.STREAM_GROUP_ID || visitId,
    country: c.req.header("CF-IPCountry") ?? c.req.raw.cf?.country ?? "XX",
    device: detectDevice(userAgent),
    time: Date.now(),
    ip: c.req.header("CF-Connecting-IP") ?? "",
    meta: {
      visitId,
      path: String(body.path ?? "/").slice(0, 200),
      referrer: String(body.referrer ?? "").slice(0, 200),
      userAgent: userAgent.slice(0, 300),
    },
  };
  c.executionCtx.waitUntil(Promise.all([sendVisitToStream(c.env, record), saveVisitLocally(c.env, visitId, record)]));
  return c.body(null, 204);
});

function jsonError(c, status, message) {
  return c.json({ error: message }, status);
}

async function invalidateCatalog(env) {
  try { await env.APP_KV.delete(CATALOG_CACHE_KEY); } catch { /* Cache failure must not turn a committed write into a failed response. */ }
}

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64url(value) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(padded + "=".repeat((4 - padded.length % 4) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function createSession(env, user) {
  const payload = base64url(encoder.encode(JSON.stringify({ sub: user.id, exp: Date.now() + SESSION_SECONDS * 1000 })));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(env.SESSION_SECRET), encoder.encode(payload)));
  return `${payload}.${base64url(signature)}`;
}

async function decodeSession(env, token) {
  if (!token || !env.SESSION_SECRET) return null;
  try {
    const [payload, signature] = token.split(".");
    if (!payload || !signature) return null;
    const valid = await crypto.subtle.verify("HMAC", await hmacKey(env.SESSION_SECRET), fromBase64url(signature), encoder.encode(payload));
    if (!valid) return null;
    const session = JSON.parse(new TextDecoder().decode(fromBase64url(payload)));
    if (session.exp < Date.now()) return null;
    return session;
  } catch { return null; }
}

async function currentUser(c) {
  const session = await decodeSession(c.env, getCookie(c, SESSION_COOKIE));
  if (!session) return null;
  return c.env.APP_DB.prepare("SELECT id, name, email, role, is_active FROM users WHERE id = ?")
    .bind(session.sub).first();
}

async function userRequired(c, next) {
  const user = await currentUser(c);
  if (!user || !user.is_active) return jsonError(c, 401, "Vui lòng đăng nhập lại.");
  c.set("user", user);
  return next();
}

async function adminRequired(c, next) {
  const user = await currentUser(c);
  if (!user || !user.is_active) return jsonError(c, 401, "Vui lòng đăng nhập lại.");
  if (user.role !== "admin") return jsonError(c, 403, "Bạn không có quyền thực hiện thao tác này.");
  c.set("user", user);
  return next();
}

async function hashPassword(password, saltBytes = crypto.getRandomValues(new Uint8Array(16))) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: saltBytes, iterations: 180000, hash: "SHA-256" }, key, 256);
  return `pbkdf2$180000$${base64url(saltBytes)}$${base64url(new Uint8Array(bits))}`;
}

async function verifyPassword(password, stored) {
  try {
    const [, rounds, salt, expected] = stored.split("$");
    const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: fromBase64url(salt), iterations: Number(rounds), hash: "SHA-256" }, key, 256);
    const actual = new Uint8Array(bits);
    const wanted = fromBase64url(expected);
    if (actual.length !== wanted.length) return false;
    let difference = 0;
    for (let index = 0; index < actual.length; index++) difference |= actual[index] ^ wanted[index];
    return difference === 0;
  } catch { return false; }
}

function validEmail(value) {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function isImageContent(file) {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (file.type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (file.type === "image/png") return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => bytes[i] === v);
  if (file.type === "image/webp") return String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (file.type === "image/avif") return String.fromCharCode(...bytes.slice(4, 8)) === "ftyp" && ["avif", "avis"].includes(String.fromCharCode(...bytes.slice(8, 12)));
  return false;
}

async function enforceSameOrigin(c, next) {
  const origin = c.req.header("Origin");
  if (origin && new URL(origin).host !== new URL(c.req.url).host) return jsonError(c, 403, "Origin không hợp lệ.");
  return next();
}

app.use("/api/*", async (c, next) => {
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  await next();
});

app.get("/api/status", (c) => c.json({ status: "ok", app: "shop-cloudflare" }));

app.post("/api/auth/register", enforceSameOrigin, async (c) => {
  const body = await c.req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = body?.password;
  if (name.length < 2 || name.length > 80 || !validEmail(email) || typeof password !== "string" || password.length < 10 || password.length > 128) {
    return jsonError(c, 400, "Tên, email hoặc mật khẩu chưa hợp lệ. Mật khẩu cần từ 10 ký tự.");
  }
  const id = crypto.randomUUID();
  try {
    await c.env.APP_DB.prepare("INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)")
      .bind(id, name, email, await hashPassword(password)).run();
  } catch (error) {
    if (String(error).includes("UNIQUE")) return jsonError(c, 409, "Email này đã được đăng ký.");
    throw error;
  }
  const user = { id, name, email, role: "user" };
  setCookie(c, SESSION_COOKIE, await createSession(c.env, user), { httpOnly: true, secure: new URL(c.req.url).protocol === "https:", sameSite: "Lax", path: "/", maxAge: SESSION_SECONDS });
  return c.json({ user }, 201);
});

app.post("/api/auth/login", enforceSameOrigin, async (c) => {
  const body = await c.req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!validEmail(email) || !password || password.length > 128) return jsonError(c, 400, "Email hoặc mật khẩu chưa hợp lệ.");
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  const rateKey = `login-fail:${ip}`;
  const failures = Number(await c.env.APP_KV.get(rateKey) ?? "0");
  if (failures >= 12) return jsonError(c, 429, "Thử lại sau ít phút.");
  const user = await c.env.APP_DB.prepare("SELECT id, name, email, password_hash, role, is_active FROM users WHERE email = ?").bind(email).first();
  if (!user || !user.is_active || !(await verifyPassword(password, user.password_hash))) {
    await c.env.APP_KV.put(rateKey, String(failures + 1), { expirationTtl: 900 });
    return jsonError(c, 401, "Email hoặc mật khẩu không đúng.");
  }
  await c.env.APP_KV.delete(rateKey);
  setCookie(c, SESSION_COOKIE, await createSession(c.env, user), { httpOnly: true, secure: new URL(c.req.url).protocol === "https:", sameSite: "Lax", path: "/", maxAge: SESSION_SECONDS });
  const { password_hash, ...safeUser } = user;
  return c.json({ user: safeUser });
});

app.post("/api/auth/logout", enforceSameOrigin, (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

app.get("/api/auth/me", async (c) => {
  const user = await currentUser(c);
  if (!user || !user.is_active) return c.json({ user: null });
  const { is_active, ...safeUser } = user;
  return c.json({ user: safeUser });
});

async function productList(db) {
  const { results = [] } = await db.prepare(`
    SELECT p.id, p.name, p.description, p.price_vnd, p.stock, p.created_at,
      (SELECT COUNT(*) FROM reviews r WHERE r.product_id = p.id AND r.is_hidden = 0) AS review_count,
      (SELECT ROUND(AVG(r.rating), 1) FROM reviews r WHERE r.product_id = p.id AND r.is_hidden = 0) AS rating
    FROM products p WHERE p.is_active = 1 ORDER BY p.created_at DESC LIMIT 100
  `).all();
  if (!results.length) return [];
  const ids = results.map((p) => p.id);
  const placeholders = ids.map(() => "?").join(",");
  const images = await db.prepare(`SELECT id, product_id, position FROM product_images WHERE product_id IN (${placeholders}) ORDER BY position`).bind(...ids).all();
  const byProduct = new Map();
  for (const image of images.results ?? []) {
    if (!byProduct.has(image.product_id)) byProduct.set(image.product_id, []);
    byProduct.get(image.product_id).push({ id: image.id, url: `/api/images/${image.id}` });
  }
  return results.map((product) => ({ ...product, images: byProduct.get(product.id) ?? [] }));
}

app.get("/api/products", async (c) => {
  const key = CATALOG_CACHE_KEY;
  const cached = await c.env.APP_KV.get(key, "json").catch(() => null);
  if (cached) return c.json({ products: cached, cached: true });
  const products = await productList(c.env.APP_DB);
  await c.env.APP_KV.put(key, JSON.stringify(products), { expirationTtl: 60 }).catch(() => {});
  return c.json({ products, cached: false });
});

app.get("/api/products/:id", async (c) => {
  const product = await c.env.APP_DB.prepare(`SELECT id, name, description, price_vnd, stock FROM products WHERE id = ? AND is_active = 1`).bind(c.req.param("id")).first();
  if (!product) return jsonError(c, 404, "Không tìm thấy sản phẩm.");
  const [images, reviews] = await Promise.all([
    c.env.APP_DB.prepare("SELECT id FROM product_images WHERE product_id = ? ORDER BY position").bind(product.id).all(),
    c.env.APP_DB.prepare(`SELECT r.id, r.rating, r.content, r.created_at, u.name AS user_name FROM reviews r JOIN users u ON u.id = r.user_id WHERE r.product_id = ? AND r.is_hidden = 0 ORDER BY r.created_at DESC LIMIT 100`).bind(product.id).all(),
  ]);
  return c.json({ product: { ...product, images: (images.results ?? []).map((image) => ({ ...image, url: `/api/images/${image.id}` })), reviews: reviews.results ?? [] } });
});

app.get("/api/images/:id", async (c) => {
  const image = await c.env.APP_DB.prepare("SELECT r2_key, content_type FROM product_images WHERE id = ?").bind(c.req.param("id")).first();
  if (!image) return c.notFound();
  const object = await c.env.IMAGE_BUCKET.get(image.r2_key);
  if (!object) return c.notFound();
  return new Response(object.body, { headers: { "Content-Type": image.content_type, "Cache-Control": "public, max-age=31536000, immutable", ETag: object.httpEtag, "X-Content-Type-Options": "nosniff" } });
});

app.get("/api/cart", userRequired, async (c) => {
  const { results = [] } = await c.env.APP_DB.prepare(`
    SELECT ci.product_id, ci.quantity, p.name, p.price_vnd, p.stock, p.is_active,
      (SELECT id FROM product_images WHERE product_id = p.id ORDER BY position LIMIT 1) AS image_id
    FROM cart_items ci JOIN products p ON p.id = ci.product_id
    WHERE ci.user_id = ? ORDER BY ci.updated_at DESC
  `).bind(c.get("user").id).all();
  return c.json({ items: results.map((item) => ({ ...item, image_url: item.image_id ? `/api/images/${item.image_id}` : null })) });
});

app.post("/api/cart/items", userRequired, enforceSameOrigin, async (c) => {
  const body = await c.req.json().catch(() => null);
  const quantity = Number(body?.quantity ?? 1);
  if (typeof body?.product_id !== "string" || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) return jsonError(c, 400, "Sản phẩm hoặc số lượng không hợp lệ.");
  const product = await c.env.APP_DB.prepare("SELECT stock FROM products WHERE id = ? AND is_active = 1").bind(body.product_id).first();
  if (!product) return jsonError(c, 404, "Không tìm thấy sản phẩm.");
  const existing = await c.env.APP_DB.prepare("SELECT quantity FROM cart_items WHERE user_id = ? AND product_id = ?").bind(c.get("user").id, body.product_id).first();
  if (Number(existing?.quantity ?? 0) + quantity > Math.min(product.stock, 99)) return jsonError(c, 409, "Mỗi sản phẩm tối đa 99 món hoặc theo số lượng tồn kho.");
  await c.env.APP_DB.prepare(`INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?, ?, ?) ON CONFLICT(user_id, product_id) DO UPDATE SET quantity = cart_items.quantity + excluded.quantity, updated_at = CURRENT_TIMESTAMP`)
    .bind(c.get("user").id, body.product_id, quantity).run();
  return c.json({ ok: true }, 201);
});

app.patch("/api/cart/items/:productId", userRequired, enforceSameOrigin, async (c) => {
  const body = await c.req.json().catch(() => null);
  const quantity = Number(body?.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) return jsonError(c, 400, "Mỗi sản phẩm tối đa 99 món.");
  const result = await c.env.APP_DB.prepare(`UPDATE cart_items SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND product_id = ? AND ? <= (SELECT stock FROM products WHERE id = ?)`)
    .bind(quantity, c.get("user").id, c.req.param("productId"), quantity, c.req.param("productId")).run();
  if (!result.meta.changes) return jsonError(c, 409, "Không cập nhật được giỏ hàng hoặc số lượng vượt tồn kho.");
  return c.json({ ok: true });
});

app.delete("/api/cart/items/:productId", userRequired, enforceSameOrigin, async (c) => {
  await c.env.APP_DB.prepare("DELETE FROM cart_items WHERE user_id = ? AND product_id = ?").bind(c.get("user").id, c.req.param("productId")).run();
  return c.json({ ok: true });
});

app.post("/api/orders/checkout", userRequired, enforceSameOrigin, async (c) => {
  const body = await c.req.json().catch(() => null);
  const recipientName = typeof body?.recipient_name === "string" ? body.recipient_name.trim() : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  const address = typeof body?.address === "string" ? body.address.trim() : "";
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  const digits = phone.replace(/\D/g, "").length;
  if (recipientName.length < 2 || recipientName.length > 100 || !/^[+\d][\d\s()-]{7,18}$/.test(phone) || digits < 9 || digits > 15 || address.length < 8 || address.length > 500 || note.length > 1000) {
    return jsonError(c, 400, "Vui lòng kiểm tra tên người nhận, số điện thoại và địa chỉ giao hàng.");
  }
  const user = c.get("user");
  const { results = [] } = await c.env.APP_DB.prepare(`
    SELECT ci.product_id, ci.quantity, p.is_active
    FROM cart_items ci JOIN products p ON p.id = ci.product_id
    WHERE ci.user_id = ? ORDER BY p.id
  `).bind(user.id).all();
  if (!results.length) return jsonError(c, 400, "Giỏ hàng đang trống.");
  if (results.length > 100) return jsonError(c, 400, "Một đơn hàng hỗ trợ tối đa 100 sản phẩm.");
  if (results.some((item) => !item.is_active)) return jsonError(c, 409, "Giỏ hàng có sản phẩm đã ngừng bán. Hãy xóa sản phẩm đó rồi thử lại.");

  const orderId = crypto.randomUUID();
  const statements = [
    c.env.APP_DB.prepare(`INSERT INTO orders (id, user_id, buyer_email, recipient_name, phone, address, note, subtotal_vnd, total_vnd) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)`)
      .bind(orderId, user.id, user.email, recipientName, phone, address, note),
    c.env.APP_DB.prepare(`
      UPDATE products
      SET stock = stock - (SELECT ci.quantity FROM cart_items ci WHERE ci.user_id = ? AND ci.product_id = products.id)
      WHERE id IN (SELECT product_id FROM cart_items WHERE user_id = ?)
        AND NOT EXISTS (
          SELECT 1 FROM cart_items ci
          LEFT JOIN products available ON available.id = ci.product_id
          WHERE ci.user_id = ? AND (available.id IS NULL OR available.is_active != 1 OR available.stock < ci.quantity)
        )
    `).bind(user.id, user.id, user.id),
    // changes() is the guarded inventory UPDATE above. A failed reservation inserts a zero quantity
    // sentinel, violating the CHECK constraint and rolling back the complete D1 batch.
    c.env.APP_DB.prepare(`
      INSERT INTO order_items (id, order_id, product_id_snapshot, product_name, unit_price_vnd, quantity)
      SELECT lower(hex(randomblob(16))), ?, ci.product_id, p.name, p.price_vnd, ci.quantity
      FROM cart_items ci JOIN products p ON p.id = ci.product_id
      WHERE ci.user_id = ? AND changes() = (SELECT COUNT(*) FROM cart_items WHERE user_id = ?)
      UNION ALL
      SELECT lower(hex(randomblob(16))), ?, '', '', 0, 0
      WHERE changes() != (SELECT COUNT(*) FROM cart_items WHERE user_id = ?)
         OR (SELECT COUNT(*) FROM cart_items WHERE user_id = ?) = 0
    `).bind(orderId, user.id, user.id, orderId, user.id, user.id),
    c.env.APP_DB.prepare(`UPDATE orders SET subtotal_vnd = (SELECT COALESCE(SUM(unit_price_vnd * quantity), 0) FROM order_items WHERE order_id = ?), total_vnd = (SELECT COALESCE(SUM(unit_price_vnd * quantity), 0) FROM order_items WHERE order_id = ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(orderId, orderId, orderId),
    c.env.APP_DB.prepare("DELETE FROM cart_items WHERE user_id = ?").bind(user.id),
  ];
  try {
    await c.env.APP_DB.batch(statements);
  } catch (error) {
    if (String(error).includes("CHECK constraint failed")) return jsonError(c, 409, "Tồn kho vừa thay đổi. Hãy tải lại giỏ hàng và thử lại.");
    throw error;
  }
  await invalidateCatalog(c.env);
  const order = await c.env.APP_DB.prepare("SELECT total_vnd FROM orders WHERE id = ?").bind(orderId).first();
  return c.json({ order: { id: orderId, status: "pending", payment_method: "cod", total_vnd: order.total_vnd } }, 201);
});

app.post("/api/products/:id/reviews", userRequired, enforceSameOrigin, async (c) => {
  const body = await c.req.json().catch(() => null);
  const rating = Number(body?.rating);
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  if (!Number.isInteger(rating) || rating < 1 || rating > 5 || content.length > 2000) return jsonError(c, 400, "Đánh giá chưa hợp lệ.");
  const product = await c.env.APP_DB.prepare("SELECT id FROM products WHERE id = ? AND is_active = 1").bind(c.req.param("id")).first();
  if (!product) return jsonError(c, 404, "Không tìm thấy sản phẩm.");
  await c.env.APP_DB.prepare(`INSERT INTO reviews (id, product_id, user_id, rating, content) VALUES (?, ?, ?, ?, ?) ON CONFLICT(product_id, user_id) DO UPDATE SET rating = excluded.rating, content = excluded.content, is_hidden = 0, created_at = CURRENT_TIMESTAMP`)
    .bind(crypto.randomUUID(), product.id, c.get("user").id, rating, content).run();
  await invalidateCatalog(c.env);
  return c.json({ ok: true }, 201);
});

app.get("/api/admin/summary", adminRequired, async (c) => {
  const row = await c.env.APP_DB.prepare(`
    SELECT (SELECT COUNT(*) FROM users WHERE role = 'user') AS users,
      (SELECT COUNT(*) FROM products WHERE is_active = 1) AS products,
      (SELECT COUNT(*) FROM reviews WHERE is_hidden = 0) AS reviews,
      (SELECT ROUND(AVG(rating), 1) FROM reviews WHERE is_hidden = 0) AS average_rating,
      (SELECT COALESCE(SUM(quantity), 0) FROM cart_items) AS items_in_carts,
      (SELECT COUNT(*) FROM orders WHERE status = 'delivered') AS delivered_orders,
      (SELECT COALESCE(SUM(total_vnd), 0) FROM orders WHERE status = 'delivered') AS revenue_vnd,
      (SELECT COUNT(*) FROM orders WHERE status = 'pending') AS pending_orders
  `).first();
  return c.json({ summary: row });
});

app.get("/api/admin/orders", adminRequired, async (c) => {
  const { results = [] } = await c.env.APP_DB.prepare("SELECT * FROM orders ORDER BY created_at DESC LIMIT 500").all();
  if (!results.length) return c.json({ orders: [] });
  const ids = results.map((order) => order.id);
  const placeholders = ids.map(() => "?").join(",");
  const items = await c.env.APP_DB.prepare(`SELECT id, order_id, product_name, unit_price_vnd, quantity FROM order_items WHERE order_id IN (${placeholders}) ORDER BY rowid`).bind(...ids).all();
  const byOrder = new Map();
  for (const item of items.results ?? []) {
    if (!byOrder.has(item.order_id)) byOrder.set(item.order_id, []);
    byOrder.get(item.order_id).push(item);
  }
  return c.json({ orders: results.map((order) => ({ ...order, items: byOrder.get(order.id) ?? [] })) });
});

app.patch("/api/admin/orders/:id", adminRequired, enforceSameOrigin, async (c) => {
  const body = await c.req.json().catch(() => null);
  const transitions = { pending: ["confirmed", "cancelled"], confirmed: ["shipping", "cancelled"], shipping: ["delivered", "cancelled"], delivered: [], cancelled: [] };
  if (!Object.hasOwn(transitions, body?.status)) return jsonError(c, 400, "Trạng thái đơn hàng không hợp lệ.");
  const id = c.req.param("id");
  const order = await c.env.APP_DB.prepare("SELECT id, status FROM orders WHERE id = ?").bind(id).first();
  if (!order) return jsonError(c, 404, "Không tìm thấy đơn hàng.");
  if (!transitions[order.status].includes(body.status)) return jsonError(c, 409, "Không thể chuyển đơn hàng sang trạng thái này.");
  let result;
  if (body.status === "cancelled") {
    const [statusUpdate] = await c.env.APP_DB.batch([
      c.env.APP_DB.prepare("UPDATE orders SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = ?").bind(id, order.status),
      c.env.APP_DB.prepare(`UPDATE products SET stock = stock + (SELECT SUM(oi.quantity) FROM order_items oi WHERE oi.order_id = ? AND oi.product_id_snapshot = products.id) WHERE id IN (SELECT product_id_snapshot FROM order_items WHERE order_id = ?) AND changes() = 1`).bind(id, id),
    ]);
    result = statusUpdate;
  } else {
    result = await c.env.APP_DB.prepare("UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = ?").bind(body.status, id, order.status).run();
  }
  if (!result.meta.changes) return jsonError(c, 409, "Đơn hàng vừa được cập nhật ở nơi khác. Tải lại danh sách.");
  if (body.status === "cancelled") await invalidateCatalog(c.env);
  return c.json({ ok: true });
});

app.get("/api/admin/users", adminRequired, async (c) => {
  const { results = [] } = await c.env.APP_DB.prepare("SELECT id, name, email, is_active, created_at FROM users WHERE role = 'user' ORDER BY created_at DESC LIMIT 500").all();
  return c.json({ users: results });
});

app.patch("/api/admin/users/:id", adminRequired, enforceSameOrigin, async (c) => {
  const body = await c.req.json().catch(() => null);
  if (![true, false].includes(body?.is_active)) return jsonError(c, 400, "Trạng thái tài khoản không hợp lệ.");
  const result = await c.env.APP_DB.prepare("UPDATE users SET is_active = ? WHERE id = ? AND role = 'user'").bind(Number(body.is_active), c.req.param("id")).run();
  if (!result.meta.changes) return jsonError(c, 404, "Không tìm thấy người dùng.");
  return c.json({ ok: true });
});

app.delete("/api/admin/users/:id", adminRequired, enforceSameOrigin, async (c) => {
  const result = await c.env.APP_DB.prepare("DELETE FROM users WHERE id = ? AND role = 'user'").bind(c.req.param("id")).run();
  if (!result.meta.changes) return jsonError(c, 404, "Không tìm thấy người dùng.");
  return c.json({ ok: true });
});

app.get("/api/admin/products", adminRequired, async (c) => {
  const { results = [] } = await c.env.APP_DB.prepare(`SELECT p.*, (SELECT COUNT(*) FROM product_images i WHERE i.product_id=p.id) AS image_count FROM products p ORDER BY p.created_at DESC LIMIT 500`).all();
  return c.json({ products: results });
});

app.get("/api/admin/products/:id/images", adminRequired, async (c) => {
  const { results = [] } = await c.env.APP_DB.prepare("SELECT id, content_type, position FROM product_images WHERE product_id = ? ORDER BY position").bind(c.req.param("id")).all();
  return c.json({ images: results.map((image) => ({ ...image, url: `/api/images/${image.id}` })) });
});

app.post("/api/admin/products/:id/images", adminRequired, enforceSameOrigin, async (c) => {
  const productId = c.req.param("id");
  const product = await c.env.APP_DB.prepare("SELECT id FROM products WHERE id = ?").bind(productId).first();
  if (!product) return jsonError(c, 404, "Không tìm thấy sản phẩm.");
  const form = await c.req.parseBody({ all: true });
  const files = [form.images].flat().filter((value) => value instanceof File && value.size > 0);
  const count = await c.env.APP_DB.prepare("SELECT COUNT(*) AS total FROM product_images WHERE product_id = ?").bind(productId).first();
  if (!files.length || Number(count.total) + files.length > 10) return jsonError(c, 400, "Mỗi sản phẩm hỗ trợ tối đa 10 ảnh.");
  if (files.some((file) => file.size > MAX_IMAGE_BYTES || !IMAGE_TYPES.has(file.type))) return jsonError(c, 400, "Ảnh phải là JPG, PNG, WebP hoặc AVIF, tối đa 5 MB mỗi ảnh.");
  for (const file of files) if (!(await isImageContent(file))) return jsonError(c, 400, "Nội dung tệp không khớp với định dạng ảnh.");
  let position = Number(count.total);
  for (const file of files) {
    const imageId = crypto.randomUUID();
    const key = `products/${productId}/${imageId}.${IMAGE_TYPES.get(file.type)}`;
    await c.env.IMAGE_BUCKET.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
    try {
      await c.env.APP_DB.prepare("INSERT INTO product_images (id, product_id, r2_key, content_type, position) VALUES (?, ?, ?, ?, ?)").bind(imageId, productId, key, file.type, position++).run();
    } catch (error) {
      await c.env.IMAGE_BUCKET.delete(key);
      throw error;
    }
  }
  await invalidateCatalog(c.env);
  return c.json({ ok: true }, 201);
});

app.delete("/api/admin/products/:id/images/:imageId", adminRequired, enforceSameOrigin, async (c) => {
  const image = await c.env.APP_DB.prepare("SELECT r2_key FROM product_images WHERE id = ? AND product_id = ?").bind(c.req.param("imageId"), c.req.param("id")).first();
  if (!image) return jsonError(c, 404, "Không tìm thấy ảnh.");
  await c.env.APP_DB.prepare("DELETE FROM product_images WHERE id = ?").bind(c.req.param("imageId")).run();
  await c.env.IMAGE_BUCKET.delete(image.r2_key);
  await invalidateCatalog(c.env);
  return c.json({ ok: true });
});

app.post("/api/admin/products", adminRequired, enforceSameOrigin, async (c) => {
  const form = await c.req.parseBody({ all: true });
  const name = typeof form.name === "string" ? form.name.trim() : "";
  const description = typeof form.description === "string" ? form.description.trim() : "";
  const price = Number(form.price_vnd);
  const stock = Number(form.stock);
  const files = [form.images].flat().filter((value) => value instanceof File && value.size > 0);
  if (name.length < 2 || name.length > 160 || description.length > 10000 || !Number.isSafeInteger(price) || price < 0 || price > 1000000000 || !Number.isInteger(stock) || stock < 0 || stock > 1000000) return jsonError(c, 400, "Thông tin sản phẩm chưa hợp lệ. Giá tối đa 1 tỷ đồng; tồn kho tối đa 1 triệu.");
  if (!files.length || files.length > 10) return jsonError(c, 400, "Mỗi sản phẩm cần từ 1 đến 10 ảnh.");
  if (files.some((file) => file.size > MAX_IMAGE_BYTES || !IMAGE_TYPES.has(file.type))) return jsonError(c, 400, "Ảnh phải là JPG, PNG, WebP hoặc AVIF, tối đa 5 MB mỗi ảnh.");
  for (const file of files) {
    if (!(await isImageContent(file))) return jsonError(c, 400, "Nội dung tệp không khớp với định dạng ảnh.");
  }
  const id = crypto.randomUUID();
  const stored = [];
  try {
    await c.env.APP_DB.prepare("INSERT INTO products (id, name, description, price_vnd, stock) VALUES (?, ?, ?, ?, ?)").bind(id, name, description, price, stock).run();
    for (const [position, file] of files.entries()) {
      const imageId = crypto.randomUUID();
      const key = `products/${id}/${imageId}.${IMAGE_TYPES.get(file.type)}`;
      await c.env.IMAGE_BUCKET.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
      stored.push(key);
      await c.env.APP_DB.prepare("INSERT INTO product_images (id, product_id, r2_key, content_type, position) VALUES (?, ?, ?, ?, ?)").bind(imageId, id, key, file.type, position).run();
    }
    await invalidateCatalog(c.env);
    return c.json({ id }, 201);
  } catch (error) {
    await c.env.APP_DB.prepare("DELETE FROM products WHERE id = ?").bind(id).run().catch(() => {});
    await Promise.all(stored.map((key) => c.env.IMAGE_BUCKET.delete(key).catch(() => {})));
    throw error;
  }
});

app.patch("/api/admin/products/:id", adminRequired, enforceSameOrigin, async (c) => {
  const body = await c.req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  const price = Number(body?.price_vnd);
  const stock = Number(body?.stock);
  const active = body?.is_active === undefined ? 1 : Number(body.is_active);
  if (name.length < 2 || name.length > 160 || description.length > 10000 || !Number.isSafeInteger(price) || price < 0 || price > 1000000000 || !Number.isInteger(stock) || stock < 0 || stock > 1000000 || ![0, 1].includes(active)) return jsonError(c, 400, "Thông tin sản phẩm chưa hợp lệ. Giá tối đa 1 tỷ đồng; tồn kho tối đa 1 triệu.");
  const result = await c.env.APP_DB.prepare("UPDATE products SET name=?, description=?, price_vnd=?, stock=?, is_active=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(name, description, price, stock, active, c.req.param("id")).run();
  if (!result.meta.changes) return jsonError(c, 404, "Không tìm thấy sản phẩm.");
  await invalidateCatalog(c.env);
  return c.json({ ok: true });
});

app.delete("/api/admin/products/:id", adminRequired, enforceSameOrigin, async (c) => {
  const images = await c.env.APP_DB.prepare("SELECT r2_key FROM product_images WHERE product_id = ?").bind(c.req.param("id")).all();
  const result = await c.env.APP_DB.prepare("DELETE FROM products WHERE id = ?").bind(c.req.param("id")).run();
  if (!result.meta.changes) return jsonError(c, 404, "Không tìm thấy sản phẩm.");
  await Promise.all((images.results ?? []).map((image) => c.env.IMAGE_BUCKET.delete(image.r2_key)));
  await invalidateCatalog(c.env);
  return c.json({ ok: true });
});

// ---- Thống kê 24 giờ qua: đọc từ bảng Iceberg do Pipeline ghi, truy vấn bằng R2 SQL ----
async function r2Sql(env, query) {
  const url = `https://api.sql.cloudflarestorage.com/api/v1/accounts/${env.CF_ACCOUNT_ID}/r2-sql/query/${env.R2_SQL_BUCKET}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.R2_SQL_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.errors?.[0]?.message || `R2 SQL lỗi ${response.status}`);
  }
  const result = data.result ?? data;
  return Array.isArray(result) ? result : (result.rows ?? []);
}

function buildHourly(timesMs) {
  const buckets = new Map();
  for (const ms of timesMs) {
    if (!Number.isFinite(ms)) continue;
    const hour = Math.floor(ms / 3600000);
    buckets.set(hour, (buckets.get(hour) ?? 0) + 1);
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([hour_bucket, visits]) => ({ hour_bucket, visits }));
}

// Nguồn dự phòng: bảng visits trong D1 (được ghi song song với stream).
async function analyticsFromD1(env, since, now) {
  const db = env.APP_DB;
  const [countryRes, deviceRes, timeRes] = await Promise.all([
    db.prepare("SELECT country, COUNT(*) AS visits FROM visits WHERE time >= ? GROUP BY country ORDER BY visits DESC LIMIT 50").bind(since).all(),
    db.prepare("SELECT device, COUNT(*) AS visits FROM visits WHERE time >= ? GROUP BY device ORDER BY visits DESC LIMIT 20").bind(since).all(),
    db.prepare("SELECT time FROM visits WHERE time >= ? ORDER BY time LIMIT 20000").bind(since).all(),
  ]);
  const countries = (countryRes.results ?? []).map((r) => ({ country: r.country, visits: Number(r.visits) }));
  const devices = (deviceRes.results ?? []).map((r) => ({ device: r.device, visits: Number(r.visits) }));
  const totalVisits = countries.reduce((sum, r) => sum + r.visits, 0);
  const hourly = buildHourly((timeRes.results ?? []).map((r) => Number(r.time)));
  return { countries, devices, totalVisits, hourly, source: "d1", timeRange: { from: since, to: now } };
}

app.get("/api/admin/analytics", adminRequired, async (c) => {
  const env = c.env;
  const now = Date.now();
  const since = now - 24 * 60 * 60 * 1000;
  const r2Configured = env.CF_ACCOUNT_ID && env.R2_SQL_BUCKET && env.R2_SQL_TOKEN && env.R2_SQL_TABLE
    && !String(env.CF_ACCOUNT_ID).startsWith("REPLACE") && !String(env.R2_SQL_BUCKET).startsWith("REPLACE") && !String(env.R2_SQL_TABLE).includes("REPLACE");

  // Chưa có quyền đọc catalog của giảng viên => dùng số liệu ghi song song trong D1.
  if (!r2Configured) {
    try {
      return c.json({ ...(await analyticsFromD1(env, since, now)), note: "Đang hiển thị số liệu từ D1 của web này (chưa cấu hình R2 SQL để đọc catalog)." });
    } catch (error) {
      console.error("D1 analytics error:", error);
      return c.json({ countries: [], devices: [], totalVisits: 0, hourly: [], error: `Không lấy được thống kê: ${error.message}. Hãy chạy migration 0003_visits.sql.` }, 500);
    }
  }

  const table = String(env.R2_SQL_TABLE);
  if (!/^[A-Za-z0-9_.]+$/.test(table)) return c.json({ countries: [], devices: [], totalVisits: 0, hourly: [], error: "R2_SQL_TABLE không hợp lệ." }, 500);

  const sinceIso = new Date(since).toISOString().replace(/\.\d{3}Z$/, "Z");
  let where = `WHERE time >= '${sinceIso}'`;
  // Stream dùng chung nhiều nhóm: chỉ đếm bản ghi của nhóm mình.
  if (env.STREAM_GROUP_ID) where += ` AND id = '${String(env.STREAM_GROUP_ID).replaceAll("'", "''")}'`;

  try {
    const [countryRows, deviceRows, timeRows] = await Promise.all([
      r2Sql(env, `SELECT country, COUNT(*) AS visits FROM ${table} ${where} GROUP BY country ORDER BY COUNT(*) DESC LIMIT 50`),
      r2Sql(env, `SELECT device, COUNT(*) AS visits FROM ${table} ${where} GROUP BY device ORDER BY COUNT(*) DESC LIMIT 20`),
      r2Sql(env, `SELECT time FROM ${table} ${where} LIMIT 20000`).catch(() => []),
    ]);
    const countries = countryRows.map((r) => ({ country: r.country, visits: Number(r.visits) }));
    const devices = deviceRows.map((r) => ({ device: r.device, visits: Number(r.visits) }));
    const totalVisits = countries.reduce((sum, r) => sum + r.visits, 0);
    const hourly = buildHourly(timeRows.map((r) => (typeof r.time === "number" ? r.time : Date.parse(r.time))));
    return c.json({ countries, devices, totalVisits, hourly, source: "r2-sql", timeRange: { from: since, to: now } });
  } catch (error) {
    console.error("R2 SQL error, falling back to D1:", error);
    try {
      return c.json({ ...(await analyticsFromD1(env, since, now)), note: `R2 SQL lỗi (${error.message}); đang hiển thị số liệu từ D1.` });
    } catch {
      return c.json({ countries: [], devices: [], totalVisits: 0, hourly: [], error: `Không lấy được thống kê: ${error.message}` }, 502);
    }
  }
});

app.get("/api/admin/reviews", adminRequired, async (c) => {
  const { results = [] } = await c.env.APP_DB.prepare(`SELECT r.id, r.rating, r.content, r.is_hidden, r.created_at, p.name AS product_name, u.name AS user_name FROM reviews r JOIN products p ON p.id=r.product_id JOIN users u ON u.id=r.user_id ORDER BY r.created_at DESC LIMIT 500`).all();
  return c.json({ reviews: results });
});

app.patch("/api/admin/reviews/:id", adminRequired, enforceSameOrigin, async (c) => {
  const body = await c.req.json().catch(() => null);
  if (![true, false].includes(body?.is_hidden)) return jsonError(c, 400, "Trạng thái đánh giá không hợp lệ.");
  const result = await c.env.APP_DB.prepare("UPDATE reviews SET is_hidden = ? WHERE id = ?").bind(Number(body.is_hidden), c.req.param("id")).run();
  if (!result.meta.changes) return jsonError(c, 404, "Không tìm thấy đánh giá.");
  await invalidateCatalog(c.env);
  return c.json({ ok: true });
});

app.delete("/api/admin/reviews/:id", adminRequired, enforceSameOrigin, async (c) => {
  const result = await c.env.APP_DB.prepare("DELETE FROM reviews WHERE id = ?").bind(c.req.param("id")).run();
  if (!result.meta.changes) return jsonError(c, 404, "Không tìm thấy đánh giá.");
  await invalidateCatalog(c.env);
  return c.json({ ok: true });
});

app.notFound((c) => c.req.path.startsWith("/api/") ? jsonError(c, 404, "Không tìm thấy API.") : c.env.ASSETS.fetch(c.req.raw));
app.onError((error, c) => {
  console.error("API error:", error);
  return jsonError(c, 500, "Có lỗi xảy ra. Vui lòng thử lại.");
});

export default app;
