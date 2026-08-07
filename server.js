require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');

const db = require('./db');
const { extractText } = require('./parsers');
const { analyze } = require('./analyze');
const { generateReportFile } = require('./report');
const { callGroq } = require('./agent/groqClient');
const { toolDefinitions, toolRegistry } = require('./agent/tools');
const { getPending, setPending, clearPending } = require('./agent/pendingActions');
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
const UPLOAD_ROOT = path.join(__dirname, '..', 'data', 'uploads');
const REPORT_ROOT = path.join(__dirname, '..', 'data', 'reports');

// ---- 1. Upload dữ liệu thô của 1 tháng (nhiều file, nhiều định dạng) ----
const upload = multer({ dest: path.join(__dirname, '..', 'data', 'tmp') });

app.post('/api/batches', upload.array('files', 50), async (req, res) => {
  try {
    const thang = req.body.thang; // "2026-08"
    if (!thang) return res.status(400).json({ error: 'Thiếu trường "thang" (vd: 2026-08)' });
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'Chưa upload file nào' });

    const info = db.prepare('INSERT INTO batches (thang, status) VALUES (?, ?)').run(thang, 'uploaded');
    const batchId = info.lastInsertRowid;
    const batchDir = path.join(UPLOAD_ROOT, String(batchId));
    fs.mkdirSync(batchDir, { recursive: true });

    for (const f of req.files) {
      const dest = path.join(batchDir, f.originalname);
      fs.renameSync(f.path, dest);
      const text = await extractText(dest);
      db.prepare('INSERT INTO files (batch_id, filename, filetype, extracted_text) VALUES (?, ?, ?, ?)').run(
        batchId, f.originalname, path.extname(f.originalname), text
      );
    }

    res.json({ batchId, thang, soFile: req.files.length, status: 'uploaded' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ---- 2. Chạy phân tích AI cho 1 batch -> ra bản ĐỀ XUẤT (chưa phải báo cáo chính thức) ----
app.post('/api/batches/:id/analyze', async (req, res) => {
  try {
    const batchId = req.params.id;
    const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(batchId);
    if (!batch) return res.status(404).json({ error: 'Không tìm thấy batch' });

    const filesRaw = db.prepare('SELECT * FROM files WHERE batch_id = ?').all(batchId);
    const files = filesRaw.map((f) => ({
      ...f,
      filepath: path.join(UPLOAD_ROOT, String(batchId), f.filename),
    }));

    const draft = await analyze(files, batch.thang);

    db.prepare(
      `INSERT INTO analysis (batch_id, draft_json) VALUES (?, ?)
       ON CONFLICT(batch_id) DO UPDATE SET draft_json = excluded.draft_json`
    ).run(batchId, JSON.stringify(draft));

    db.prepare('UPDATE batches SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('analyzed', batchId);

    res.json({ batchId, status: 'analyzed', draft, note: 'Đây là ĐỀ XUẤT của AI - cần người dùng xác nhận (POST /confirm) trước khi phát hành báo cáo chính thức.' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ---- 3. Xem bản đề xuất hiện tại ----
app.get('/api/batches/:id', (req, res) => {
  const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(req.params.id);
  if (!batch) return res.status(404).json({ error: 'Không tìm thấy batch' });
  const analysis = db.prepare('SELECT * FROM analysis WHERE batch_id = ?').get(req.params.id);
  res.json({
    batch,
    draft: analysis ? JSON.parse(analysis.draft_json) : null,
    confirmed: analysis && analysis.confirmed_json ? JSON.parse(analysis.confirmed_json) : null,
    report_path: analysis ? analysis.report_path : null,
  });
});

// ---- 4. NGƯỜI DÙNG XÁC NHẬN (có thể sửa nội dung trước khi duyệt) -> mới thật sự tạo file Word ----
app.post('/api/batches/:id/confirm', async (req, res) => {
  try {
    const batchId = req.params.id;
    const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(batchId);
    if (!batch) return res.status(404).json({ error: 'Không tìm thấy batch' });

    const analysisRow = db.prepare('SELECT * FROM analysis WHERE batch_id = ?').get(batchId);
    if (!analysisRow) return res.status(400).json({ error: 'Chưa có bản đề xuất, hãy gọi /analyze trước' });

    // Cho phép người dùng gửi bản đã chỉnh sửa qua body; nếu không có thì dùng nguyên bản đề xuất
    const finalData = req.body && Object.keys(req.body).length ? req.body : JSON.parse(analysisRow.draft_json);

    const outPath = await generateReportFile(finalData, REPORT_ROOT);

    db.prepare('UPDATE analysis SET confirmed_json = ?, report_path = ? WHERE batch_id = ?').run(
      JSON.stringify(finalData), outPath, batchId
    );
    db.prepare('UPDATE batches SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('confirmed', batchId);

    res.json({ batchId, status: 'confirmed', report_path: outPath });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/batches', (req, res) => {
  res.json(db.prepare('SELECT * FROM batches ORDER BY id DESC').all());
});

// ---- 5. Tải file Word báo cáo đã xác nhận ----
app.get('/api/batches/:id/download', (req, res) => {
  const analysisRow = db.prepare('SELECT * FROM analysis WHERE batch_id = ?').get(req.params.id);
  if (!analysisRow || !analysisRow.report_path || !fs.existsSync(analysisRow.report_path)) {
    return res.status(404).json({ error: 'Chưa có báo cáo đã xác nhận cho batch này' });
  }
  res.download(analysisRow.report_path);
});
const chatSessions = new Map();
const SYSTEM_PROMPT = `Bạn là "Trợ lý của Minh Hà", trợ lý QC cho hệ thống báo cáo chất lượng dịch vụ Sakuko.
- Trả lời ngắn gọn, tự nhiên, bằng tiếng Việt.
- Khi người dùng hỏi về batch, phân tích, hay xác nhận báo cáo, hãy gọi tool phù hợp thay vì tự bịa số liệu.
- Không bao giờ nói đã "phát hành báo cáo" nếu confirm_batch chưa thật sự chạy xong.`;

const CONFIRM_WORDS = ['xác nhận', 'đồng ý', 'ok làm đi', 'yes', 'confirm'];
const REJECT_WORDS = ['huỷ', 'hủy', 'không đồng ý', 'thôi', 'cancel'];

function getHistory(sessionId) {
  if (!chatSessions.has(sessionId)) {
    chatSessions.set(sessionId, [{ role: 'system', content: SYSTEM_PROMPT }]);
  }
  return chatSessions.get(sessionId);
}

app.post('/api/chat', async (req, res) => {
  try {
    const { sessionId = 'default', message } = req.body;
    if (!message) return res.status(400).json({ error: 'Thiếu message' });

    const history = getHistory(sessionId);
    const lower = message.trim().toLowerCase();
    const pending = await getPending(sessionId);

    if (pending && CONFIRM_WORDS.some((w) => lower.includes(w))) {
      const payload = JSON.parse(pending.payload);
      const tool = toolRegistry[pending.tool_name];
      const result = await tool.handler(payload);
      await clearPending(sessionId);
      const reply = `Dạ em đã thực hiện xong: ${JSON.stringify(result)}`;
      history.push({ role: 'user', content: message }, { role: 'assistant', content: reply });
      return res.json({ reply });
    }

    if (pending && REJECT_WORDS.some((w) => lower.includes(w))) {
      await clearPending(sessionId);
      const reply = 'Dạ em đã huỷ, chưa có gì thay đổi ạ.';
      history.push({ role: 'user', content: message }, { role: 'assistant', content: reply });
      return res.json({ reply });
    }

    history.push({ role: 'user', content: message });
    let assistantMsg = await callGroq(history, toolDefinitions);

    if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
      history.push(assistantMsg);

      for (const call of assistantMsg.tool_calls) {
        const toolName = call.function.name;
        const args = JSON.parse(call.function.arguments || '{}');
        const tool = toolRegistry[toolName];
        if (!tool) continue;

        if (tool.requiresConfirmation) {
          await setPending(sessionId, toolName, args);
          const reply = `Em sẽ thực hiện: **${toolName}** (${JSON.stringify(args)}). Chị gõ "xác nhận" để em làm, hoặc "huỷ" nếu không cần nữa nhé.`;
          history.push({ role: 'assistant', content: reply });
          return res.json({ reply, needsConfirmation: true });
        }

        const result = await tool.handler(args);
        history.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
      }

      assistantMsg = await callGroq(history, toolDefinitions);
    }

    history.push({ role: 'assistant', content: assistantMsg.content });
    res.json({ reply: assistantMsg.content });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});
app.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ---- Lịch tự động: ngày 1 hàng tháng, tự tìm batch "uploaded" mới nhất và chạy /analyze ----
// (Không tự "confirm" - vẫn chờ người dùng duyệt, đúng nguyên tắc AI chỉ đề xuất.)
cron.schedule('0 8 1 * *', async () => {
  console.log('[CRON] Kiểm tra batch chờ phân tích đầu tháng...');
  const pending = db.prepare("SELECT * FROM batches WHERE status = 'uploaded' ORDER BY id DESC LIMIT 1").get();
  if (!pending) {
    console.log('[CRON] Không có dữ liệu nào đang chờ - cần upload thủ công trước.');
    return;
  }
  const filesRaw = db.prepare('SELECT * FROM files WHERE batch_id = ?').all(pending.id);
  const files = filesRaw.map((f) => ({
    ...f,
    filepath: path.join(UPLOAD_ROOT, String(pending.id), f.filename),
  }));
  const draft = await analyze(files, pending.thang);
  db.prepare(
    `INSERT INTO analysis (batch_id, draft_json) VALUES (?, ?)
     ON CONFLICT(batch_id) DO UPDATE SET draft_json = excluded.draft_json`
  ).run(pending.id, JSON.stringify(draft));
  db.prepare('UPDATE batches SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('analyzed', pending.id);
  console.log(`[CRON] Đã tạo đề xuất cho batch #${pending.id} (${pending.thang}) - chờ xác nhận thủ công.`);
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.BIND_HOST || '0.0.0.0'; // xem DEPLOY.md để giới hạn qua Tailscale
app.listen(PORT, HOST, () => console.log(`QC Report Bot đang chạy tại http://${HOST}:${PORT}`));
