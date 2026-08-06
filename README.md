# QC Report Bot — Bot tự động tổng hợp báo cáo chấm điểm dịch vụ

## Kiến trúc (đúng nguyên tắc: AI chỉ ĐỀ XUẤT, người dùng XÁC NHẬN mới phát hành)

```
Upload nhiều file (Excel/Word/ảnh)
        ↓
  Trích xuất text (xlsx, mammoth)
        ↓
  AI tổng hợp -> bản ĐỀ XUẤT (draft_json)     <-- chưa phải báo cáo chính thức
        ↓
  Người dùng xem/sửa -> XÁC NHẬN (/confirm)
        ↓
  Sinh file Word chính thức (.docx)
```

Có 2 chế độ chạy:
- **Có `ANTHROPIC_API_KEY`**: AI thật đọc toàn bộ nội dung (kể cả Word/ghi chú định tính), tổng hợp sâu.
- **Không có key**: tự chuyển sang rule-based (chỉ đọc được cột "Tên, Điểm" trong Excel) — vẫn chạy hết pipeline để demo/kiểm thử.

## Cài đặt

```bash
npm install
cp .env.example .env   # điền GROQ_API_KEY (miễn phí, đăng ký tại console.groq.com)
npm start               # chạy tại http://localhost:3000
```

**Chi phí = 0đ**: Groq có free tier vĩnh viễn, không cần thẻ tín dụng. Nếu sau này công ty
có ngân sách và muốn chất lượng phân tích cao hơn, có thể điền thêm `ANTHROPIC_API_KEY`
(trả phí) — hệ thống sẽ tự ưu tiên Groq trước, chỉ dùng Anthropic nếu không có Groq key.

## Cách lấy GROQ_API_KEY miễn phí

1. Vào https://console.groq.com, đăng ký bằng email hoặc Google (không cần thẻ).
2. Vào **API Keys** → **Create API Key**.
3. Dán vào `.env`: `GROQ_API_KEY=gsk_...`

Giới hạn free tier (đủ dùng cho báo cáo hàng tháng, không đủ cho traffic lớn liên tục):
khoảng 30 request/phút, 1.000 request/ngày. Một batch phân tích tháng chỉ tốn vài request
(1 request/ảnh để mô tả + 1 request tổng hợp cuối) nên rất dư dả cho nhu cầu 1 lần/tháng.

## API

| Việc | Endpoint |
|---|---|
| Upload dữ liệu 1 tháng | `POST /api/batches` (form-data: `thang=2026-08`, nhiều `files`) |
| Chạy AI phân tích | `POST /api/batches/:id/analyze` |
| Xem bản đề xuất | `GET /api/batches/:id` |
| **Xác nhận & xuất Word** | `POST /api/batches/:id/confirm` (có thể gửi body JSON đã sửa để override bản AI đề xuất) |
| Danh sách các đợt | `GET /api/batches` |

## Chạy tự động hàng tháng

Cron nội bộ (`node-cron`) chạy `0 8 1 * *` — 8h sáng ngày 1 hàng tháng, tự tìm batch mới nhất đang ở trạng thái "uploaded" và chạy phân tích. **Không tự confirm** — vẫn cần anh/chị bấm xác nhận thủ công để tôn trọng nguyên tắc con người duyệt cuối.

→ Quy trình thực tế hàng tháng: đầu tháng upload dữ liệu thô (thủ công) → bot tự phân tích lúc 8h ngày 1 (nếu đã upload trước đó) hoặc anh/chị gọi `/analyze` bất cứ lúc nào → xem/sửa → `/confirm` để lấy file Word.

## Việc cần làm tiếp để dùng thật

1. **Lấy GROQ_API_KEY miễn phí** (xem hướng dẫn ở trên) — không tốn tiền, để AI đọc được
   cả nội dung định tính (ghi chú Word, phản ánh khách hàng...) và cả ảnh, không chỉ đọc số.
2. **Giao diện upload** — đã có sẵn tại `public/index.html`, phục vụ qua `npm start`.
3. **Triển khai thật**: xem `DEPLOY.md` — chạy trên máy/server nội bộ sẵn có của công ty
   (miễn phí) bằng `pm2`, mở qua Tailscale VPN (free tier tới 6 người dùng) thay vì public.
