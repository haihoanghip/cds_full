# Chợ Nhà — Cloudflare shop

Webapp bán hàng tối ưu cho điện thoại. React/Vite phục vụ giao diện; Hono chạy REST API trên Cloudflare Workers. Backend dùng D1 cho dữ liệu quan hệ, R2 cho toàn bộ ảnh sản phẩm và Workers KV cho cache danh mục cùng giới hạn thử đăng nhập ở mức best-effort.

## Cấu hình Cloudflare

1. Cài Node.js LTS và chạy `npm install`.
2. Tạo D1 database, R2 bucket và KV namespace trên Cloudflare.
3. Điền database ID, bucket name và KV namespace ID vào `wrangler.toml`.
4. Cấu hình secret phiên đăng nhập:

   ```powershell
   npx wrangler secret put SESSION_SECRET
   ```

   Nhập một secret ngẫu nhiên dài tối thiểu 32 ký tự. Khi chạy local, tạo `.dev.vars` với `SESSION_SECRET="một-secret-ngẫu-nhiên-dài"`; không đưa tệp này lên Git.

5. Áp dụng schema local: `npm run db:local`.
6. Chạy giao diện Vite và Worker API ở hai terminal: `npm run dev:worker`, sau đó `npm run dev`. Mở địa chỉ Vite hiển thị trong terminal.
7. Deploy bằng `npm run deploy` sau khi đã cấu hình bindings production và secret.

Lệnh `npm run db:remote` tác động database production. Chỉ chạy sau khi xác nhận ID database đích và đã cấu hình bindings.

## Tạo tài khoản admin đầu tiên

Đăng ký tài khoản bình thường, sau đó đổi vai trò tài khoản đó trong Cloudflare D1 Console:

```sql
UPDATE users SET role = 'admin' WHERE email = 'admin@example.com';
```

Đăng xuất rồi đăng nhập lại để tải quyền mới. Người dùng đăng ký qua giao diện luôn có vai trò `user`; API quản trị chỉ dành cho `admin`.

## Tính năng hiện có

- User đăng ký/đăng nhập, xem và tìm sản phẩm, quản lý giỏ hàng, gửi hoặc cập nhật đánh giá.
- User tạo đơn từ giỏ hàng với thanh toán COD, xem xác nhận đơn ngay sau khi đặt.
- Admin xem tổng quan, cập nhật trạng thái đơn (chờ xác nhận → đã xác nhận → đang giao → đã giao; có thể hủy trước khi giao), quản lý sản phẩm/ảnh, khóa/mở khóa/xóa user và ẩn/hiện/xóa đánh giá.
- Giá sản phẩm tối đa 1 tỷ VND; số lượng tối đa 99 món cho mỗi sản phẩm trong giỏ. Mỗi đơn tối đa 100 sản phẩm.
- Upload ảnh giới hạn 10 ảnh/sản phẩm, 5 MB/ảnh, chỉ nhận JPEG, PNG, WebP, AVIF; API kiểm tra chữ ký tệp và ghi binary vào R2. D1 chỉ giữ metadata và khóa R2.
- Session dùng cookie HttpOnly, SameSite=Lax, chữ ký HMAC và thời hạn 7 ngày. Trạng thái user/role được đọc từ D1 ở mỗi request cần đăng nhập, nên tài khoản bị khóa mất quyền truy cập API ngay.
- KV cache danh sách sản phẩm trong 60 giây và được xóa khi dữ liệu sản phẩm/đánh giá thay đổi.
- Khi tạo đơn, giá và tên sản phẩm được chụp vào `order_items`; tồn kho được trừ trong batch D1 nguyên tử. Hủy đơn sẽ hoàn tồn kho. Doanh thu chỉ cộng các đơn đã giao.
- API routes nằm trong `src/index.js`; schema nằm trong `migrations/0001_shop.sql` và `migrations/0002_orders.sql`.

## Giới hạn phạm vi hiện tại

Chưa tích hợp cổng thanh toán trực tuyến; đơn hiện thanh toán khi nhận hàng. Phí giao hàng chưa được tính nên tổng đơn bằng tạm tính sản phẩm. Dashboard có số đơn đã giao, đơn chờ xác nhận và doanh thu đơn đã giao, cùng thống kê user, sản phẩm, đánh giá, điểm sao trung bình và sản phẩm trong giỏ.

Workers KV có độ nhất quán cuối cùng và không có phép tăng nguyên tử như Redis. Vì vậy phần giới hạn đăng nhập qua KV là best-effort; không dùng KV làm nguồn dữ liệu chính cho nghiệp vụ giao dịch.


## Thống kê truy cập 24 giờ (quốc gia / thiết bị)

Luồng: trình duyệt gọi `POST /api/track` (1 lần/phiên) → Worker gửi bản ghi `{id, country, device, time, ip, meta}` tới Cloudflare Stream (`STREAM_URL`, xem `ketnoi/inpo.txt`) → Pipeline ghi vào bảng Iceberg trong R2 → tab **Phân tích truy cập** của admin gọi `GET /api/admin/analytics`, truy vấn R2 SQL cho 24 giờ gần nhất.

Cấu hình:

1. Trong `wrangler.toml` điền `CF_ACCOUNT_ID`, `R2_SQL_BUCKET` (bucket đã bật R2 Data Catalog), `R2_SQL_TABLE` (dạng `namespace.table`).
2. Tạo secret: `npx wrangler secret put R2_SQL_TOKEN` (token có quyền R2 SQL Read, R2 Data Catalog, R2 Storage). Nếu stream bật xác thực: `npx wrangler secret put STREAM_TOKEN`.
3. Khi chạy local, thêm hai biến trên vào `.dev.vars`.
4. Thử gửi dữ liệu mẫu bằng `restfull/test.http` (body là mảng JSON, `time` tính bằng mili-giây).

5. Chạy migration mới `0003_visits.sql` (`npm run db:local` / `npm run db:remote`): mỗi lượt truy cập còn được ghi song song vào bảng `visits` trong D1. Nếu chưa điền R2 SQL (hoặc R2 SQL lỗi), tab **Phân tích truy cập** tự động dùng số liệu từ D1.
6. Stream của giảng viên dùng chung nhiều nhóm: điền `STREAM_GROUP_ID` trong `wrangler.toml` (ví dụ `nhóm 06 CNTT K22E`) để trường `id` của bản ghi là tên nhóm và truy vấn R2 SQL chỉ đếm bản ghi của nhóm bạn. Mã từng lượt truy cập nằm trong `meta.visitId`.

Lưu ý: endpoint `ingest.cloudflare.com` chỉ GHI dữ liệu. Muốn ĐỌC từ catalog của giảng viên cần giảng viên cung cấp `CF_ACCOUNT_ID`, tên bucket, tên bảng và một API token có quyền R2 SQL Read.
