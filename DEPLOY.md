# Triển khai thật: PM2 + Tailscale VPN

Mục tiêu: bot chạy 24/7 trên 1 máy (server nội bộ / mini PC / VPS), chỉ truy cập được
qua mạng Tailscale riêng của công ty — không public ra internet, đúng tinh thần
Chặng 13 (Tailscale VPN gating) đã học trong AI Academy.

## Bước 1 — Giữ tiến trình sống bằng PM2

```bash
npm install -g pm2
cd qc-report-bot
cp .env.example .env        # điền ANTHROPIC_API_KEY thật vào đây
pm2 start src/server.js --name qc-report-bot
pm2 save                    # lưu lại để tự khởi động lại khi server reboot
pm2 startup                 # in ra lệnh cần chạy 1 lần để PM2 tự chạy cùng hệ điều hành
```

Kiểm tra:
```bash
pm2 status
pm2 logs qc-report-bot      # xem log realtime, hữu ích khi debug /analyze lỗi
```

## Bước 2 — Cài Tailscale trên máy chạy bot

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Đăng nhập bằng tài khoản Tailscale của công ty (cùng tailnet với các thiết bị đã
setup ở Chặng 13). Sau khi `tailscale up` thành công, máy sẽ có 1 địa chỉ IP dạng
`100.x.y.z` — chỉ các thiết bị trong cùng tailnet mới gọi được vào IP này.

## Bước 3 — Chặn truy cập ngoài tailnet (gating)

Bot hiện đang lắng nghe ở `0.0.0.0:3000` (mọi interface). Để chỉ cho phép truy cập
qua Tailscale, đổi sang chỉ bind vào IP Tailscale của máy:

```js
// src/server.js, dòng cuối — thay:
app.listen(PORT, () => ...);
// bằng:
app.listen(PORT, process.env.BIND_HOST || '0.0.0.0', () => ...);
```

rồi trong `.env` thêm:
```
BIND_HOST=100.x.y.z   # địa chỉ Tailscale của máy chạy bot, xem bằng: tailscale ip -4
```

Nếu máy chạy sau NAT/firewall công ty, cách này đã đủ — cổng 3000 sẽ không mở ra
ngoài mạng LAN/internet, chỉ mở trong tailnet.

## Bước 4 — Truy cập từ máy khác trong công ty

Từ bất kỳ máy nào đã cài Tailscale và join cùng tailnet:
```
http://100.x.y.z:3000
```

Có thể đặt tên gợi nhớ trong Tailscale Admin Console (Machines → Edit machine name)
thành `qc-report-bot`, khi đó truy cập bằng `http://qc-report-bot:3000` (MagicDNS).

## Bước 5 — Backup dữ liệu (nối Chặng 14–15 đã học)

Dữ liệu quan trọng cần backup định kỳ:
- `data/app.db` — toàn bộ lịch sử batch, đề xuất AI, báo cáo đã xác nhận
- `data/reports/` — các file Word đã phát hành
- `.env` — **không backup lên Git/Drive public**, chỉ lưu ở nơi an toàn (chứa API key)

Có thể tái dùng script backup GitHub/Google Drive tự động đã làm ở Chặng 14 để
backup 2 mục đầu theo lịch, tách riêng `.env` ra khỏi vòng backup tự động.

## Checklist trước khi coi là "chạy thật"

- [ ] `pm2 status` báo `online`, không bị restart loop
- [ ] `.env` có `ANTHROPIC_API_KEY` thật (kiểm tra: log không còn dòng "chuyển sang fallback rule-based")
- [ ] Truy cập `http://<tailscale-ip>:3000` từ máy khác trong tailnet thành công
- [ ] Truy cập từ máy **ngoài** tailnet bị từ chối (test bằng 4G/mạng ngoài)
- [ ] Đã upload + confirm thử 1 batch thật, tải được file Word về đúng nội dung
- [ ] `pm2 startup` đã chạy — reboot máy thử 1 lần, bot tự sống lại
