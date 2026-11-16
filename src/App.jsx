import { useEffect, useMemo, useState } from "react";

const money = (value) => new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(value ?? 0);

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, { credentials: "same-origin", ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Không thể hoàn tất yêu cầu.");
  return data;
}

function Stars({ value = 0 }) {
  return <span className="stars" aria-label={`${value} trên 5 sao`}>{"★".repeat(Math.round(value))}{"☆".repeat(5 - Math.round(value))}</span>;
}

function ProductCard({ product, onOpen, onAdd }) {
  return <article className="product-card">
    <button className="product-photo" onClick={() => onOpen(product)} aria-label={`Xem ${product.name}`}>
      {product.images?.[0] ? <img src={product.images[0].url} alt={product.name} loading="lazy" /> : <span className="photo-placeholder">✳</span>}
      {product.stock < 1 && <span className="sold-out">Tạm hết hàng</span>}
    </button>
    <div className="product-info">
      <button className="product-name" onClick={() => onOpen(product)}>{product.name}</button>
      <div className="product-rating"><Stars value={product.rating ?? 0} /><span>{product.review_count ?? 0} đánh giá</span></div>
      <div className="product-bottom"><strong>{money(product.price_vnd)}</strong><button className="add-button" onClick={() => onAdd(product)} disabled={product.stock < 1} aria-label="Thêm vào giỏ">+</button></div>
    </div>
  </article>;
}

function AuthDialog({ onClose, onSuccess }) {
  const [mode, setMode] = useState("login");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setError(""); setBusy(true);
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(form.entries());
    try {
      const result = await api(`/auth/${mode === "login" ? "login" : "register"}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      onSuccess(result.user);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="dialog auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title">
      <button className="close-button" onClick={onClose} aria-label="Đóng">×</button>
      <p className="eyebrow">CHÀO MỪNG BẠN</p><h2 id="auth-title">{mode === "login" ? "Đăng nhập" : "Tạo tài khoản"}</h2>
      <p className="muted">{mode === "login" ? "Đăng nhập để mua sắm và theo dõi giỏ hàng." : "Tạo tài khoản để bắt đầu khám phá cửa hàng."}</p>
      <form className="form-stack" onSubmit={submit}>
        {mode === "register" && <label>Họ tên<input name="name" autoComplete="name" required minLength="2" maxLength="80" /></label>}
        <label>Email<input name="email" type="email" autoComplete="email" required /></label>
        <label>Mật khẩu<input name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength="10" /></label>
        {error && <p className="form-error">{error}</p>}
        <button className="button button-dark button-full" disabled={busy}>{busy ? "Đang xử lý…" : mode === "login" ? "Đăng nhập" : "Tạo tài khoản"}</button>
      </form>
      <button className="text-button switch-auth" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>{mode === "login" ? "Chưa có tài khoản? Đăng ký" : "Đã có tài khoản? Đăng nhập"}</button>
    </section>
  </div>;
}

function ProductDialog({ product, user, onClose, onChanged, notify, onLogin }) {
  const [detail, setDetail] = useState(null);
  const [activeImage, setActiveImage] = useState(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  useEffect(() => { api(`/products/${product.id}`).then((data) => setDetail(data.product)).catch((e) => setError(e.message)); }, [product.id]);
  async function submitReview(event) {
    event.preventDefault();
    if (!user) return onLogin();
    const reviewForm = event.currentTarget;
    const form = new FormData(reviewForm); setSending(true); setError("");
    try {
      await api(`/products/${product.id}/reviews`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rating: Number(form.get("rating")), content: form.get("content") }) });
      notify("Đã gửi đánh giá."); onChanged();
      const refreshed = await api(`/products/${product.id}`); setDetail(refreshed.product); reviewForm.reset();
    } catch (e) { setError(e.message); } finally { setSending(false); }
  }
  return <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="dialog product-dialog" role="dialog" aria-modal="true" aria-labelledby="detail-title">
      <button className="close-button" onClick={onClose} aria-label="Đóng">×</button>
      <div className="detail-layout"><div><div className="detail-image">{(activeImage ?? detail?.images?.[0]) ? <img src={(activeImage ?? detail?.images?.[0]).url} alt={detail?.name ?? product.name} /> : <span className="photo-placeholder">✳</span>}</div>{detail?.images?.length > 1 && <div className="detail-thumbnails">{detail.images.map((image) => <button className={(activeImage ?? detail.images[0]).id === image.id ? "active" : ""} key={image.id} onClick={() => setActiveImage(image)}><img src={image.url} alt="" /></button>)}</div>}</div>
        <div className="detail-content"><p className="eyebrow">SẢN PHẨM</p><h2 id="detail-title">{detail?.name ?? product.name}</h2><p className="detail-price">{money(detail?.price_vnd ?? product.price_vnd)}</p><p className="muted detail-description">{detail?.description || "Sản phẩm đang được cập nhật mô tả."}</p><p className="stock-line">Còn {detail?.stock ?? product.stock} sản phẩm</p><button className="button button-orange" disabled={!detail?.stock} onClick={async () => { try { if (!user) return onLogin(); await api("/cart/items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ product_id: product.id }) }); notify("Đã thêm vào giỏ hàng."); } catch (e) { notify(e.message, true); } }}>Thêm vào giỏ hàng</button></div></div>
      <div className="review-section"><h3>Đánh giá sản phẩm</h3>{detail?.reviews?.length ? detail.reviews.map((review) => <div className="review" key={review.id}><div><strong>{review.user_name}</strong><Stars value={review.rating} /><span className="review-date">{new Date(review.created_at).toLocaleDateString("vi-VN")}</span></div><p>{review.content || "Đánh giá sản phẩm"}</p></div>) : <p className="muted">Chưa có đánh giá nào.</p>}
        {user?.role !== "admin" && <form className="review-form" onSubmit={submitReview}><h4>Chia sẻ trải nghiệm</h4><label>Đánh giá<select name="rating" defaultValue="5"><option value="5">5 sao — Rất hài lòng</option><option value="4">4 sao — Hài lòng</option><option value="3">3 sao — Bình thường</option><option value="2">2 sao — Chưa hài lòng</option><option value="1">1 sao — Không hài lòng</option></select></label><label>Nội dung<textarea name="content" rows="3" maxLength="2000" placeholder="Sản phẩm thế nào?" /></label>{error && <p className="form-error">{error}</p>}<button className="button button-outline" disabled={sending}>{sending ? "Đang gửi…" : "Gửi đánh giá"}</button></form>}
      </div>
    </section>
  </div>;
}

function CartDrawer({ user, onClose, notify, onChanged }) {
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [placing, setPlacing] = useState(false);
  const [placedOrder, setPlacedOrder] = useState(null);
  async function load() { try { setItems((await api("/cart")).items); } catch (e) { setError(e.message); } }
  useEffect(() => { load(); }, []);
  const total = items.reduce((sum, item) => sum + item.price_vnd * item.quantity, 0);
  async function remove(id) { try { await api(`/cart/items/${id}`, { method: "DELETE" }); await load(); onChanged(); } catch (e) { notify(e.message, true); } }
  async function checkout(event) {
    event.preventDefault(); setPlacing(true); setError("");
    const form = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const result = await api("/orders/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      setPlacedOrder(result.order); setItems([]); onChanged();
    } catch (e) { setError(e.message); } finally { setPlacing(false); }
  }
  return <div className="overlay drawer-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="cart-drawer" aria-label="Giỏ hàng"><div className="drawer-head"><div><p className="eyebrow">CỦA BẠN</p><h2>Giỏ hàng <span>{items.length}</span></h2></div><button className="close-button" onClick={onClose} aria-label="Đóng">×</button></div>
    {placedOrder ? <div className="order-success"><span>✓</span><h3>Đặt hàng thành công</h3><p>Mã đơn <strong>{placedOrder.id}</strong></p><p>{money(placedOrder.total_vnd)} · Thanh toán khi nhận hàng</p><button className="button button-outline" onClick={onClose}>Tiếp tục mua sắm</button></div> : <>
      {error && <p className="form-error cart-error">{error}</p>}
      {items.length === 0 ? <div className="empty-state"><span>♧</span><strong>Giỏ hàng đang trống</strong><p>Thêm vài món bạn yêu thích nhé.</p></div> : <div className="cart-list">{items.map((item) => <article className="cart-item" key={item.product_id}><div className="cart-thumb">{item.image_url && <img src={item.image_url} alt="" />}</div><div className="cart-item-copy"><strong>{item.name}</strong><span>{money(item.price_vnd)}</span>{!item.is_active ? <><em className="unavailable-item">Sản phẩm đã ngừng bán</em><button className="remove-inactive" onClick={() => remove(item.product_id)}>Xóa khỏi giỏ hàng</button></> : <div className="quantity-control"><button onClick={async () => { if (item.quantity <= 1) return remove(item.product_id); try { await api(`/cart/items/${item.product_id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quantity: item.quantity - 1 }) }); await load(); } catch (e) { notify(e.message, true); } }}>−</button><span>{item.quantity}</span><button onClick={async () => { try { await api(`/cart/items/${item.product_id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quantity: item.quantity + 1 }) }); await load(); } catch (e) { notify(e.message, true); } }}>+</button><button className="remove-item" onClick={() => remove(item.product_id)}>Xóa</button></div>}</div></article>)}</div>}
      {items.length > 0 && <><div className="cart-total"><div><span>Tạm tính</span><strong>{money(total)}</strong></div><p>Phí giao hàng hiện chưa được tính.</p></div><form className="checkout-form" onSubmit={checkout}><h3>Giao hàng · Thanh toán COD</h3><label>Người nhận<input name="recipient_name" defaultValue={user.name} required minLength="2" maxLength="100" /></label><label>Số điện thoại<input name="phone" type="tel" autoComplete="tel" required placeholder="09xx xxx xxx" /></label><label>Địa chỉ nhận hàng<textarea name="address" autoComplete="street-address" rows="2" required minLength="8" maxLength="500" /></label><label>Ghi chú (không bắt buộc)<input name="note" maxLength="1000" /></label><button className="button button-orange" disabled={placing}>{placing ? "Đang tạo đơn…" : `Đặt hàng · ${money(total)}`}</button></form></>}
    </>}
  </aside></div>;
}

function AdminPanel({ notify }) {
  const [tab, setTab] = useState("summary");
  const [summary, setSummary] = useState(null);
  const [users, setUsers] = useState([]);
  const [products, setProducts] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [orders, setOrders] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [editing, setEditing] = useState(null);
  const [editingImages, setEditingImages] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState("");

  async function load() {
    try {
      const [s, u, p, r, o] = await Promise.all([api("/admin/summary"), api("/admin/users"), api("/admin/products"), api("/admin/reviews"), api("/admin/orders")]);
      setSummary(s.summary); setUsers(u.users); setProducts(p.products); setReviews(r.reviews); setOrders(o.orders);
    } catch (e) { setError(e.message); }
  }

  async function loadAnalytics() {
    setAnalyticsLoading(true);
    setAnalyticsError("");
    try {
      const data = await api("/admin/analytics");
      setAnalytics(data);
    } catch (e) {
      setAnalyticsError(e.message);
    } finally {
      setAnalyticsLoading(false);
    }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { if (tab === "analytics") loadAnalytics(); }, [tab]);

  const tabs = [["summary", "Tổng quan"], ["orders", "Đơn hàng"], ["products", "Sản phẩm"], ["users", "Người dùng"], ["reviews", "Đánh giá"], ["analytics", "Phân tích truy cập"]];
  async function toggleUser(user) { try { await api(`/admin/users/${user.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_active: !user.is_active }) }); await load(); notify(user.is_active ? "Đã khóa tài khoản." : "Đã mở khóa tài khoản."); } catch (e) { notify(e.message, true); } }
  async function deleteUser(user) { if (!window.confirm(`Xóa tài khoản ${user.email}? Dữ liệu liên quan như đánh giá và giỏ hàng cũng sẽ bị xóa.`)) return; try { await api(`/admin/users/${user.id}`, { method: "DELETE" }); await load(); notify("Đã xóa tài khoản."); } catch (e) { notify(e.message, true); } }
  async function deleteProduct(product) { if (!window.confirm(`Xóa sản phẩm “${product.name}” và các ảnh liên quan?`)) return; try { await api(`/admin/products/${product.id}`, { method: "DELETE" }); await load(); notify("Đã xóa sản phẩm."); } catch (e) { notify(e.message, true); } }
  async function deleteReview(review) { if (!window.confirm("Xóa đánh giá này?")) return; try { await api(`/admin/reviews/${review.id}`, { method: "DELETE" }); await load(); notify("Đã xóa đánh giá."); } catch (e) { notify(e.message, true); } }
  async function saveProduct(event) {
    event.preventDefault(); setError(""); setBusy(true);
    const productForm = event.currentTarget;
    const form = new FormData(productForm);
    try {
      if (editing) {
        await api(`/admin/products/${editing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.get("name"), description: form.get("description"), price_vnd: Number(form.get("price_vnd")), stock: Number(form.get("stock")), is_active: Number(form.get("is_active")) }) });
      } else {
        await api("/admin/products", { method: "POST", body: form });
      }
      productForm.reset(); setEditing(null); await load(); notify(editing ? "Đã cập nhật sản phẩm." : "Đã tạo sản phẩm và lưu ảnh lên R2.");
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function openProductEditor(product) {
    setEditing(product);
    try { setEditingImages((await api(`/admin/products/${product.id}/images`)).images); }
    catch (e) { notify(e.message, true); }
  }
  async function uploadMoreImages(event) {
    const input = event.currentTarget;
    if (!input.files?.length || !editing) return;
    const form = new FormData();
    for (const file of input.files) form.append("images", file);
    try {
      await api(`/admin/products/${editing.id}/images`, { method: "POST", body: form });
      setEditingImages((await api(`/admin/products/${editing.id}/images`)).images);
      await load(); notify("Đã lưu ảnh lên R2.");
    } catch (e) { notify(e.message, true); } finally { input.value = ""; }
  }
  async function removeProductImage(image) {
    if (editingImages.length < 2) return notify("Sản phẩm cần giữ ít nhất một ảnh.", true);
    try {
      await api(`/admin/products/${editing.id}/images/${image.id}`, { method: "DELETE" });
      setEditingImages((await api(`/admin/products/${editing.id}/images`)).images);
      await load(); notify("Đã xóa ảnh.");
    } catch (e) { notify(e.message, true); }
  }
  async function toggleReview(review) { try { await api(`/admin/reviews/${review.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_hidden: !review.is_hidden }) }); await load(); notify(review.is_hidden ? "Đã hiện đánh giá." : "Đã ẩn đánh giá."); } catch (e) { notify(e.message, true); } }
  async function changeOrderStatus(order, status) {
    if (status === "cancelled" && !window.confirm(`Hủy đơn ${order.id.slice(0, 8)}? Tồn kho sẽ được hoàn lại.`)) return;
    try { await api(`/admin/orders/${order.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) }); await load(); notify("Đã cập nhật trạng thái đơn hàng."); }
    catch (e) { notify(e.message, true); }
  }
  return <div className="admin-layout"><aside className="admin-nav"><p className="eyebrow">QUẢN TRỊ CỬA HÀNG</p>{tabs.map(([key, label]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => { setTab(key); setError(""); }}>{label}<span>›</span></button>)}</aside>
    <section className="admin-content"><div className="admin-title"><div><p className="eyebrow">ADMIN WORKSPACE</p><h1>{tabs.find(([key]) => key === tab)?.[1]}</h1></div><button className="button button-outline button-small" onClick={load}>Làm mới</button></div>
      {error && <p className="form-error">{error}</p>}
      {tab === "summary" && <>{summary && <div className="stat-grid"><article><span>Người dùng</span><strong>{summary.users}</strong></article><article><span>Sản phẩm đang bán</span><strong>{summary.products}</strong></article><article><span>Đơn chờ xác nhận</span><strong>{summary.pending_orders}</strong></article><article><span>Đơn đã giao</span><strong>{summary.delivered_orders}</strong></article><article><span>Doanh thu đơn đã giao</span><strong className="stat-money">{money(summary.revenue_vnd)}</strong></article><article><span>Đánh giá hiển thị</span><strong>{summary.reviews}</strong></article><article><span>Điểm trung bình</span><strong>{summary.average_rating ?? "—"}<small>/ 5</small></strong></article><article><span>Sản phẩm trong giỏ</span><strong>{summary.items_in_carts}</strong></article></div>}<p className="admin-note">Doanh thu được cộng từ các đơn đã giao. Phí vận chuyển hiện chưa được tính; thanh toán được ghi nhận theo COD.</p></>}
      {tab === "orders" && <div className="table-card"><h3>{orders.length} đơn hàng</h3>{orders.length ? orders.map((order) => <article className="admin-order" key={order.id}><div className="admin-order-top"><div><strong>Đơn #{order.id.slice(0, 8).toUpperCase()}</strong><span>{new Date(`${order.created_at.replace(" ", "T")}Z`).toLocaleString("vi-VN")}</span></div><strong className="order-total">{money(order.total_vnd)}</strong></div><p className="admin-order-buyer">{order.recipient_name} · {order.phone}<br />{order.address}</p><div className="admin-order-items">{order.items.map((item) => <span key={item.id}>{item.product_name} × {item.quantity} · {money(item.unit_price_vnd * item.quantity)}</span>)}</div><div className="admin-order-actions"><span className={`order-status status-${order.status}`}>{({ pending: "Chờ xác nhận", confirmed: "Đã xác nhận", shipping: "Đang giao", delivered: "Đã giao", cancelled: "Đã hủy" })[order.status]}</span>{order.status !== "delivered" && order.status !== "cancelled" && <select aria-label="Cập nhật trạng thái đơn hàng" value={order.status} onChange={(event) => changeOrderStatus(order, event.target.value)}><option value={order.status}>Cập nhật trạng thái…</option>{(order.status === "pending" ? ["confirmed", "cancelled"] : order.status === "confirmed" ? ["shipping", "cancelled"] : ["delivered", "cancelled"]).map((status) => <option key={status} value={status}>{({ confirmed: "Xác nhận", shipping: "Bàn giao vận chuyển", delivered: "Đánh dấu đã giao", cancelled: "Hủy đơn" })[status]}</option>)}</select>}</div></article>) : <p className="muted">Chưa có đơn hàng.</p>}</div>}
      {tab === "products" && <div className="admin-columns"><form key={editing?.id ?? "new-product"} className="admin-form card-panel" onSubmit={saveProduct}><h3>{editing ? "Sửa sản phẩm" : "Thêm sản phẩm"}</h3><label>Tên sản phẩm<input name="name" defaultValue={editing?.name ?? ""} required minLength="2" maxLength="160" /></label><label>Mô tả<textarea name="description" defaultValue={editing?.description ?? ""} rows="4" maxLength="10000" /></label><div className="form-row"><label>Giá (VND)<input name="price_vnd" type="number" min="0" max="1000000000" step="1" defaultValue={editing?.price_vnd ?? ""} required /></label><label>Tồn kho<input name="stock" type="number" min="0" max="1000000" defaultValue={editing?.stock ?? 0} required /></label></div>{editing ? <><label>Trạng thái<select name="is_active" defaultValue={editing.is_active}><option value="1">Đang hiển thị</option><option value="0">Đang ẩn</option></select></label><div className="image-manager"><span>Ảnh sản phẩm ({editingImages.length}/10)</span><div className="image-manager-list">{editingImages.map((image) => <div key={image.id}><img src={image.url} alt="Ảnh sản phẩm" /><button type="button" onClick={() => removeProductImage(image)} aria-label="Xóa ảnh">×</button></div>)}</div><label>Thêm ảnh<input type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple onChange={uploadMoreImages} /><small>Tối đa 10 ảnh, 5 MB mỗi ảnh.</small></label></div></> : <label>Ảnh sản phẩm<input name="images" type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple required /><small>Từ 1 đến 10 ảnh, tối đa 5 MB mỗi ảnh.</small></label>}{error && <p className="form-error">{error}</p>}<div className="form-row"><button className="button button-orange" disabled={busy}>{busy ? "Đang lưu…" : editing ? "Lưu thay đổi" : "Tạo sản phẩm"}</button>{editing && <button type="button" className="button button-outline" onClick={() => { setEditing(null); setEditingImages([]); }}>Hủy</button>}</div></form>
        <div className="table-card"><h3>Danh sách sản phẩm</h3>{products.map((product) => <article className="admin-row" key={product.id}><div><strong>{product.name}</strong><span>{money(product.price_vnd)} · Kho {product.stock} · {product.image_count} ảnh · {product.is_active ? "Đang bán" : "Đang ẩn"}</span></div><div className="row-actions"><button onClick={() => { openProductEditor(product); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Sửa</button><button className="danger-text" onClick={() => deleteProduct(product)}>Xóa</button></div></article>)}</div></div>}
      {tab === "users" && <div className="table-card"><h3>{users.length} tài khoản</h3>{users.map((user) => <article className="admin-row" key={user.id}><div><strong>{user.name}</strong><span>{user.email} · Tham gia {new Date(user.created_at).toLocaleDateString("vi-VN")}</span></div><div className="row-actions"><span className={`account-state ${user.is_active ? "active" : "locked"}`}>{user.is_active ? "Hoạt động" : "Đã khóa"}</span><button onClick={() => toggleUser(user)}>{user.is_active ? "Khóa" : "Mở khóa"}</button><button className="danger-text" onClick={() => deleteUser(user)}>Xóa</button></div></article>)}</div>}
      {tab === "reviews" && <div className="table-card"><h3>{reviews.length} đánh giá</h3>{reviews.map((review) => <article className="admin-row review-admin-row" key={review.id}><div><strong>{review.product_name} · {review.user_name}</strong><span><Stars value={review.rating} /> {review.content || "Không có nội dung"}</span></div><div className="row-actions"><span className={`account-state ${review.is_hidden ? "locked" : "active"}`}>{review.is_hidden ? "Đã ẩn" : "Đang hiện"}</span><button onClick={() => toggleReview(review)}>{review.is_hidden ? "Hiện" : "Ẩn"}</button><button className="danger-text" onClick={() => deleteReview(review)}>Xóa</button></div></article>)}</div>}
      {tab === "analytics" && <div className="table-card">
        <div className="analytics-header">
          <h3>Thống kê truy cập 24h qua</h3>
          <button className="button button-outline button-small" onClick={loadAnalytics} disabled={analyticsLoading}>
            {analyticsLoading ? "Đang tải…" : "Làm mới"}
          </button>
        </div>
        {analyticsError && <p className="form-error">{analyticsError}</p>}
        {analytics?.note && <p className="muted">{analytics.note}</p>}
        {analytics && <>
          <div className="analytics-summary">
            <article className="stat-card"><span>Tổng lượt truy cập</span><strong>{analytics.totalVisits.toLocaleString("vi-VN")}</strong></article>
            <article className="stat-card"><span>Quốc gia khác nhau</span><strong>{analytics.countries.length}</strong></article>
            <article className="stat-card"><span>Loại thiết bị</span><strong>{analytics.devices.length}</strong></article>
          </div>
          <div className="analytics-charts">
            <div className="chart-card">
              <h4>Theo quốc gia</h4>
              {analytics.countries.length > 0 ? (
                <table className="analytics-table">
                  <thead><tr><th>Quốc gia</th><th>Lượt truy cập</th><th>%</th></tr></thead>
                  <tbody>
                    {analytics.countries.map((item, idx) => (
                      <tr key={idx}>
                        <td>{item.country || "Không xác định"}</td>
                        <td>{item.visits.toLocaleString("vi-VN")}</td>
                        <td>{analytics.totalVisits > 0 ? ((item.visits / analytics.totalVisits) * 100).toFixed(1) : 0}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="muted">Chưa có dữ liệu quốc gia</p>
              )}
            </div>
            <div className="chart-card">
              <h4>Theo thiết bị</h4>
              {analytics.devices.length > 0 ? (
                <table className="analytics-table">
                  <thead><tr><th>Thiết bị</th><th>Lượt truy cập</th><th>%</th></tr></thead>
                  <tbody>
                    {analytics.devices.map((item, idx) => (
                      <tr key={idx}>
                        <td>{item.device || "Không xác định"}</td>
                        <td>{item.visits.toLocaleString("vi-VN")}</td>
                        <td>{analytics.totalVisits > 0 ? ((item.visits / analytics.totalVisits) * 100).toFixed(1) : 0}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="muted">Chưa có dữ liệu thiết bị</p>
              )}
            </div>
          </div>
          {analytics.hourly && analytics.hourly.length > 0 && (
            <div className="chart-card hourly-chart">
              <h4>Biểu đồ theo giờ (24h qua)</h4>
              <div className="hourly-bars">
                {analytics.hourly.map((item) => {
                  const maxVisits = Math.max(...analytics.hourly.map(h => h.visits));
                  const height = maxVisits > 0 ? (item.visits / maxVisits) * 100 : 0;
                  const hour = new Date(item.hour_bucket * 3600000).toLocaleTimeString("vi-VN", { hour: "2-digit", hour12: false });
                  return (
                    <div key={item.hour_bucket} className="hourly-bar" title={`${hour}: ${item.visits} lượt`}>
                      <div className="bar-fill" style={{ height: `${height}%` }}></div>
                      <span className="bar-label">{hour}</span>
                      <span className="bar-value">{item.visits}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>}
      </div>}
    </section>
  </div>;
}

function trackVisit() {
  try {
    if (sessionStorage.getItem("visit_tracked")) return;
    sessionStorage.setItem("visit_tracked", "1");
  } catch { /* sessionStorage có thể bị chặn */ }
  fetch("/api/track", { method: "POST", credentials: "same-origin", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: location.pathname, referrer: document.referrer }) }).catch(() => {});
}

export default function App() {
  useEffect(() => { trackVisit(); }, []);
  const [user, setUser] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [authOpen, setAuthOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState(null);
  const [view, setView] = useState("shop");
  const [cartCount, setCartCount] = useState(0);
  function notify(message, isError = false) { setToast({ message, isError }); window.setTimeout(() => setToast(null), 2800); }
  async function loadProducts() { try { setProducts((await api("/products")).products); } catch (e) { notify(e.message, true); } finally { setLoading(false); } }
  async function loadCartCount() { if (!user) { setCartCount(0); return; } try { const { items } = await api("/cart"); setCartCount(items.reduce((n, item) => n + item.quantity, 0)); } catch { setCartCount(0); } }
  useEffect(() => { api("/auth/me").then((data) => setUser(data.user)).catch(() => {}).finally(loadProducts); }, []);
  useEffect(() => { loadCartCount(); }, [user]);
  const filtered = useMemo(() => products.filter((item) => item.name.toLocaleLowerCase("vi").includes(search.toLocaleLowerCase("vi"))), [products, search]);
  async function addToCart(product) { if (!user) return setAuthOpen(true); try { await api("/cart/items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ product_id: product.id }) }); await loadCartCount(); notify("Đã thêm vào giỏ hàng."); } catch (e) { notify(e.message, true); } }
  async function logout() { await api("/auth/logout", { method: "POST" }).catch(() => {}); setUser(null); setView("shop"); notify("Bạn đã đăng xuất."); }
  return <div className="app-shell">
    <header className="site-header"><a className="brand" href="#" onClick={(e) => { e.preventDefault(); setView("shop"); }}><span className="brand-icon">n</span><span>chợ nhà<span className="brand-dot">.</span></span></a>
      {view === "shop" && <label className="search-box"><span>⌕</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm sản phẩm bạn yêu thích" /><kbd>⌘ K</kbd></label>}
      <nav className="header-actions">{user?.role === "admin" && <button className={`admin-link ${view === "admin" ? "selected" : ""}`} onClick={() => setView(view === "admin" ? "shop" : "admin")}>{view === "admin" ? "Cửa hàng" : "Quản trị"}</button>}{user ? <><span className="welcome">Xin chào, {user.name}</span><button className="icon-button cart-button" onClick={() => setCartOpen(true)} aria-label="Giỏ hàng">♧<i>{cartCount}</i></button><button className="avatar-button" onClick={logout} title="Đăng xuất">{user.name.slice(0, 1).toUpperCase()}</button></> : <><button className="login-link" onClick={() => setAuthOpen(true)}>Đăng nhập</button><button className="icon-button cart-button" onClick={() => setAuthOpen(true)} aria-label="Giỏ hàng">♧<i>0</i></button></>}</nav>
    </header>
    {view === "admin" && user?.role === "admin" ? <AdminPanel notify={notify} /> : <main>
      <section className="hero-banner"><div className="hero-copy"><p className="eyebrow">NHỮNG MÓN ĐỒ ĐÁNG YÊU</p><h1>Mỗi ngày vui<br />hơn một chút<span>.</span></h1><p>Chọn món bạn thích, chúng mình lo phần còn lại.</p><a href="#catalog" className="hero-cta">Khám phá ngay <span>↗</span></a></div><div className="hero-art" aria-hidden="true"><div className="sun"></div><div className="art-card art-one"><span>✿</span><small>little things<br />big joy</small></div><div className="art-card art-two"><span>☕</span></div><div className="art-flower">✳</div><div className="art-scribble">for your<br />everyday</div></div></section>
      <section className="catalog-section" id="catalog"><div className="catalog-heading"><div><p className="eyebrow">ĐƯỢC CHỌN LỌC CHO BẠN</p><h2>{search ? "Kết quả tìm kiếm" : "Món nhỏ, niềm vui lớn"}</h2></div><span>{filtered.length} sản phẩm <b>↗</b></span></div>
        {loading ? <div className="loading-grid">{[1,2,3,4].map((x) => <div className="skeleton" key={x}></div>)}</div> : filtered.length ? <div className="product-grid">{filtered.map((product) => <ProductCard key={product.id} product={product} onOpen={setSelected} onAdd={addToCart} />)}</div> : <div className="empty-shop"><span>✳</span><h3>{search ? "Chưa tìm thấy sản phẩm" : "Sản phẩm đang được cập nhật"}</h3><p>{search ? "Thử một từ khóa khác nhé." : "Quay lại sau để khám phá những món đồ mới."}</p></div>}
      </section>
      <section className="promise-strip"><div><span>✳</span><p><strong>Chọn lọc kỹ càng</strong><small>Mỗi món đều có lý do để yêu.</small></p></div><div><span>♡</span><p><strong>Chăm chút từng đơn</strong><small>Hỗ trợ bạn bằng sự tử tế.</small></p></div><div><span>↗</span><p><strong>Mua sắm an tâm</strong><small>Thông tin rõ ràng, minh bạch.</small></p></div></section>
    </main>}
    <footer className="site-footer"><a className="brand" href="#"><span className="brand-icon">n</span><span>chợ nhà<span className="brand-dot">.</span></span></a><span>Một góc nhỏ cho những điều dễ thương.</span><span>© 2026 chợ nhà</span></footer>
    {authOpen && <AuthDialog onClose={() => setAuthOpen(false)} onSuccess={(nextUser) => { setUser(nextUser); setAuthOpen(false); notify("Đăng nhập thành công."); }} />}
    {selected && <ProductDialog product={selected} user={user} onClose={() => setSelected(null)} onChanged={loadProducts} notify={notify} onLogin={() => { setSelected(null); setAuthOpen(true); }} />}
    {cartOpen && user && <CartDrawer user={user} onClose={() => setCartOpen(false)} notify={notify} onChanged={loadCartCount} />}
    {toast && <div className={`toast ${toast.isError ? "toast-error" : ""}`}>{toast.isError ? "!" : "✓"} {toast.message}</div>}
  </div>;
}
