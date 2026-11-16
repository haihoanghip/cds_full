# Hướng dẫn cài đặt và khởi động server Basin Catalog (Streamlit)

Tài liệu này hướng dẫn cài các thư viện Python cần thiết cho ứng dụng thống kê truy cập 24h trong thư mục `basinCatalog/` và khởi động server Streamlit.

## 1. Yêu cầu

| Thành phần | Yêu cầu |
|---|---|
| Hệ điều hành | macOS (đã kiểm tra trên Darwin 24.6.0), Linux hoặc Windows |
| Python | 3.9 trở lên (máy đã kiểm tra dùng Python 3.9.6 tại `/usr/bin/python3`) |
| pip | Đi kèm Python |
| Kết nối mạng | Cần để tải thư viện từ PyPI; cần thêm nếu tắt `USE_SAMPLE` (truy cập Cloudflare R2) |

Kiểm tra phiên bản Python:

```bash
python3 --version
```

## 2. Cấu trúc liên quan

```
basinCatalog/
├── app.py              # Ứng dụng Streamlit
├── requirements.txt    # Danh sách thư viện Python
├── .env                # Biến cấu hình (KHÔNG commit lên git)
└── .venv/              # Môi trường ảo (tạo ở bước 3)
```

Các thư viện trong `requirements.txt`:

- `streamlit` — giao diện web và server
- `python-dotenv` — đọc file `.env`
- `pandas` — xử lý dữ liệu
- `pyiceberg[pyarrow]` — đọc bảng Apache Iceberg trên R2
- `boto3` — kết nối S3 API của R2 (bắt buộc khi `USE_SAMPLE=0`)

## 3. Cài đặt thư viện

Di chuyển vào thư mục dự án:

```bash
cd /Volumes/data/Coffee/basinCatalog
```

Tạo môi trường ảo để tránh ảnh hưởng Python hệ thống:

```bash
python3 -m venv .venv
```

Kích hoạt môi trường ảo:

- macOS / Linux:
  ```bash
  source .venv/bin/activate
  ```
- Windows (PowerShell):
  ```powershell
  .venv\Scripts\Activate.ps1
  ```

Nâng cấp pip và cài thư viện:

```bash
pip install --upgrade pip
pip install -r requirements.txt
```

Kiểm tra cài đặt thành công:

```bash
python -c "import streamlit, pandas, pyiceberg; print('streamlit', streamlit.__version__, 'pandas', pandas.__version__, 'pyiceberg', pyiceberg.__version__)"
```

Nếu in ra số phiên bản của cả ba thư viện là đã cài xong.

> Lưu ý: Nếu không muốn dùng môi trường ảo, có thể chạy `pip3 install -r requirements.txt` trực tiếp, nhưng không khuyến nghị.

## 4. Cấu hình biến môi trường

File `.env` nằm trong `basinCatalog/` và được `app.py` tự động đọc. Các biến:

| Biến | Ý nghĩa | Ghi chú |
|---|---|---|
| `USE_SAMPLE` | `1` = dùng dữ liệu mẫu, `0` = đọc bảng Iceberg thật trên R2 | Mặc định `1` nếu không khai báo |
| `R2_ACCOUNT_ID` | Account ID Cloudflare | Chỉ cần khi `USE_SAMPLE=0` |
| `R2_BUCKET` | Tên bucket R2 chứa bảng Iceberg | Chỉ cần khi `USE_SAMPLE=0` |
| `R2_ACCESS_KEY_ID` | Access key R2 | Bí mật, không chia sẻ |
| `R2_SECRET_ACCESS_KEY` | Secret key R2 | Bí mật, không chia sẻ |

Ví dụ nội dung `.env` để chạy nhanh bằng dữ liệu mẫu:

```env
USE_SAMPLE=1
```

Để đọc dữ liệu thật từ R2, đặt `USE_SAMPLE=0` và điền đủ 4 biến `R2_*`.

## 5. Khởi động server

Đảm bảo môi trường ảo đang được kích hoạt, rồi chạy:

```bash
streamlit run app.py
```

Hoặc không cần kích hoạt môi trường ảo:

```bash
./.venv/bin/streamlit run app.py
```

Kết quả mong đợi:

```
You can now view your Streamlit app in your browser.

Local URL: http://localhost:8501
```

Mở trình duyệt tại địa chỉ **http://localhost:8501**.

### Tùy chọn khởi động

| Mục đích | Lệnh |
|---|---|
| Đổi cổng (ví dụ 8502) | `streamlit run app.py --server.port 8502` |
| Không tự mở trình duyệt | `streamlit run app.py --server.headless true` |
| Cho máy khác trong mạng LAN truy cập | `streamlit run app.py --server.address 0.0.0.0` |

Dừng server: nhấn `Ctrl + C` trong terminal.

## 6. Kiểm tra hoạt động

1. Trang hiện thông báo "Đang dùng dữ liệu mẫu" khi `USE_SAMPLE=1`.
2. Có 3 chỉ số: số IP duy nhất, số quốc gia, số lượt xem.
3. Có 2 biểu đồ cột: theo quốc gia và theo thiết bị.

## 7. Xử lý sự cố

| Triệu chứng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| `command not found: streamlit` | Chưa kích hoạt `.venv` hoặc chưa cài thư viện | Chạy lại bước 3, hoặc dùng `./.venv/bin/streamlit run app.py` |
| `ModuleNotFoundError: No module named ...` | Thư viện chưa cài vào đúng môi trường | Kích hoạt `.venv` rồi chạy `pip install -r requirements.txt` |
| `Address already in use` | Cổng 8501 đang bị chiếm | Dùng `--server.port 8502` hoặc tắt tiến trình cũ |
| `Requirement already satisfied` nhưng vẫn lỗi import | Đang dùng nhầm Python | Kiểm tra `which python` phải trỏ tới `basinCatalog/.venv/bin/python` |
| `ModuleNotFoundError: No module named 'boto3'` khi `USE_SAMPLE=0` | Thiếu thư viện boto3 | Chạy `pip install -r requirements.txt` (đã có `boto3`) |
| `SignatureDoesNotMatch` | Secret key R2 sai hoặc bị ngắt dòng trong `.env` | `R2_SECRET_ACCESS_KEY` phải dài 64 ký tự, nằm trên đúng một dòng. Kiểm tra bằng lệnh ở mục 4 |
| `AccessDenied`, `NoSuchBucket`, không tìm thấy `.metadata.json` | Sai Account ID hoặc tên bucket, hoặc bucket chưa có bảng Iceberg | Kiểm tra lại `R2_ACCOUNT_ID`, `R2_BUCKET` |
| Bảng trống | Dữ liệu cũ hơn 24 giờ | Ứng dụng chỉ lấy dữ liệu trong 24 giờ gần nhất |

Dữ liệu được cache 300 giây (`ttl=300`). Muốn tải lại ngay, dùng nút "Rerun" hoặc nhấn `R` trong trang Streamlit.

## 8. Bảo mật

- Không commit file `.env` và thư mục `.venv/` lên git.
- Không gửi `R2_ACCESS_KEY_ID` và `R2_SECRET_ACCESS_KEY` qua chat, email hay ảnh chụp màn hình.
- Nếu khóa đã bị lộ, thu hồi và tạo khóa mới trong Cloudflare dashboard.
