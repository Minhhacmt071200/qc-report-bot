require('dotenv').config();
const fs = require('fs');
const { isImage, imageMediaType } = require('./parsers');

const SYSTEM_PROMPT = `Bạn là trợ lý phân tích báo cáo chấm điểm dịch vụ cho chuỗi 23 siêu thị Sakuko.
Đầu vào là dữ liệu thô trích từ nhiều file (Excel chấm điểm, Word ghi chú, ảnh mô tả) của một tháng.
Nhiệm vụ: tổng hợp thành JSON DUY NHẤT, không kèm text khác, đúng schema:

{
  "thang": "YYYY-MM",
  "tong_quan": "1 đoạn tóm tắt tình hình chung",
  "diem_trung_binh_toan_chuoi": số,
  "sieu_thi": [
    { "ten": "...", "diem": số, "xep_loai": "Tốt/Khá/Trung bình/Kém", "van_de_noi_bat": "...", "de_xuat": "..." }
  ],
  "top_3_tot_nhat": ["...", "...", "..."],
  "top_3_can_cai_thien": ["...", "...", "..."],
  "xu_huong_so_voi_thang_truoc": "tăng/giảm/không đổi - giải thích ngắn nếu dữ liệu có đề cập",
  "de_xuat_hanh_dong": ["...", "..."]
}

Chỉ dựa trên dữ liệu được cung cấp, không bịa số liệu. Nếu thiếu dữ liệu cho 1 trường, ghi "Không đủ dữ liệu".`;

/**
 * MIỄN PHÍ — dùng Groq (OpenAI-compatible API), free tier vĩnh viễn, không cần thẻ.
 * Model text: llama-3.3-70b-versatile. Model đọc ảnh: llama-3.2-90b-vision-preview.
 * Groq free tier giới hạn ảnh trong 1 request nên nếu có ảnh, ta tách riêng 1 lượt gọi
 * để mô tả từng ảnh trước, rồi gộp mô tả đó vào cùng prompt tổng hợp text.
 */
async function callGroq(model, messages) {
  const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: 4000 }),
  });
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.choices[0].message.content.trim();
}

async function describeImageWithGroq(filepath, filename) {
  const base64 = fs.readFileSync(filepath).toString('base64');
  const content = [
    { type: 'text', text: `Đây là ảnh "${filename}" trong báo cáo chấm điểm dịch vụ siêu thị. Mô tả chi tiết mọi số liệu, tên siêu thị, điểm số, ghi chú xuất hiện trong ảnh, bằng tiếng Việt.` },
    { type: 'image_url', image_url: { url: `data:${imageMediaType(filepath)};base64,${base64}` } },
  ];
  return callGroq('llama-3.2-90b-vision-preview', [{ role: 'user', content }]);
}

async function analyzeWithGroq(files, thang) {
  const parts = [`Dữ liệu thô tháng ${thang}, tổng ${files.length} file:`];

  for (const f of files) {
    if (isImage(f.filepath)) {
      const moTa = await describeImageWithGroq(f.filepath, f.filename);
      parts.push(`### File ảnh: ${f.filename} (đã mô tả bằng AI Vision)\n${moTa}`);
    } else {
      parts.push(`### File: ${f.filename}\n${(f.extracted_text || '').slice(0, 20000)}`);
    }
  }

  const userText = parts.join('\n\n');
  const raw = await callGroq('llama-3.3-70b-versatile', [
    { role: 'system', content: SYSTEM_PROMPT + '\n\nChỉ trả về JSON thuần, không kèm câu chữ hay markdown fence nào khác.' },
    { role: 'user', content: userText },
  ]);
  const cleaned = raw.replace(/```json|```/g, '').trim();
  return JSON.parse(cleaned);
}

/**
 * TRẢ PHÍ (tuỳ chọn) — dùng Claude qua Anthropic API nếu công ty có ngân sách sau này.
 * Với file ảnh, đính kèm ảnh thật (base64) để Claude Vision đọc trực tiếp — không cần OCR riêng.
 */
async function analyzeWithClaude(files, thang) {
  const content = [
    { type: 'text', text: `Dữ liệu thô tháng ${thang}, tổng ${files.length} file:` },
  ];

  for (const f of files) {
    if (isImage(f.filepath)) {
      const base64 = fs.readFileSync(f.filepath).toString('base64');
      content.push({ type: 'text', text: `### File ảnh: ${f.filename} (đọc nội dung trực tiếp bên dưới)` });
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: imageMediaType(f.filepath), data: base64 },
      });
    } else {
      content.push({ type: 'text', text: `### File: ${f.filename}\n${(f.extracted_text || '').slice(0, 30000)}` });
    }
  }

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
    }),
  });
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  const text = data.content.map((b) => b.text || '').join('\n').trim();
  const cleaned = text.replace(/```json|```/g, '').trim();
  return JSON.parse(cleaned);
}

/**
 * Fallback KHÔNG dùng AI - tổng hợp bằng luật đơn giản từ các sheet Excel dạng
 * "Tên siêu thị, Điểm". Dùng khi chưa cấu hình ANTHROPIC_API_KEY, để demo vẫn
 * chạy hết pipeline end-to-end. Khi có API key, hệ thống tự chuyển sang dùng AI thật.
 */
function analyzeFallback(files, thang) {
  const rawText = files
    .filter((f) => !isImage(f.filepath))
    .map((f) => f.extracted_text || '')
    .join('\n');
  const soAnh = files.filter((f) => isImage(f.filepath)).length;

  const rows = [];
  const lines = rawText.split('\n');
  for (const line of lines) {
    const parts = line.split(',').map((s) => s.trim());
    if (parts.length >= 2) {
      const diem = parseFloat(parts[1]);
      if (!isNaN(diem) && parts[0] && !/^sheet|^tên|^ten/i.test(parts[0])) {
        rows.push({ ten: parts[0], diem });
      }
    }
  }

  const xepLoai = (d) => (d >= 90 ? 'Tốt' : d >= 75 ? 'Khá' : d >= 60 ? 'Trung bình' : 'Kém');
  const sieu_thi = rows.map((r) => ({
    ten: r.ten,
    diem: r.diem,
    xep_loai: xepLoai(r.diem),
    van_de_noi_bat: r.diem < 75 ? 'Cần rà soát chi tiết (dữ liệu thô chưa mô tả cụ thể)' : 'Không có',
    de_xuat: r.diem < 75 ? 'Kiểm tra lại quy trình phục vụ, đào tạo lại nhân viên' : 'Duy trì',
  }));
  const sorted = [...sieu_thi].sort((a, b) => b.diem - a.diem);
  const avg = sieu_thi.length ? sieu_thi.reduce((s, r) => s + r.diem, 0) / sieu_thi.length : 0;

  return {
    thang,
    tong_quan:
      (sieu_thi.length
        ? `Tổng hợp tự động (chế độ rule-based, chưa gắn AI thật) từ ${sieu_thi.length} siêu thị có dữ liệu điểm hợp lệ.`
        : 'Không trích xuất được dòng điểm nào từ dữ liệu thô — kiểm tra lại định dạng file đầu vào.') +
      (soAnh > 0 ? ` Có ${soAnh} ảnh đính kèm CHƯA được đọc (chế độ rule-based không đọc ảnh — cần GROQ_API_KEY để bật Vision, miễn phí).` : ''),
    diem_trung_binh_toan_chuoi: Math.round(avg * 10) / 10,
    sieu_thi,
    top_3_tot_nhat: sorted.slice(0, 3).map((r) => r.ten),
    top_3_can_cai_thien: sorted.slice(-3).reverse().map((r) => r.ten),
    xu_huong_so_voi_thang_truoc: 'Không đủ dữ liệu (chế độ demo chưa so sánh lịch sử)',
    de_xuat_hanh_dong: [
      'Gắn GROQ_API_KEY (miễn phí, đăng ký tại console.groq.com) để bật phân tích AI thật, sâu hơn (đọc được cả file Word/ghi chú định tính và cả ảnh).',
    ],
  };
}

async function analyze(files, thang) {
  // Ưu tiên Groq vì MIỄN PHÍ vĩnh viễn. Anthropic chỉ dùng nếu không có Groq key
  // (ví dụ sau này công ty quyết định trả phí để có chất lượng cao hơn).
  if (process.env.GROQ_API_KEY) {
    try {
      return await analyzeWithGroq(files, thang);
    } catch (e) {
      console.error('Groq phân tích lỗi, thử Anthropic (nếu có) hoặc fallback:', e.message);
    }
  }
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await analyzeWithClaude(files, thang);
    } catch (e) {
      console.error('AI phân tích lỗi, chuyển sang fallback rule-based:', e.message);
      return analyzeFallback(files, thang);
    }
  }
  return analyzeFallback(files, thang);
}

module.exports = { analyze };
