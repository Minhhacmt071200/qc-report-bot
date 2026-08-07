// agent/tools.js
const path = require('path');
const db = require('../db');
const { analyze } = require('../analyze');
const { generateReportFile } = require('../report');

const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'data', 'uploads');
const REPORT_ROOT = path.join(__dirname, '..', '..', 'data', 'reports');

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}
function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      err ? reject(err) : resolve(this);
    });
  });
}

// ---- Tool 1: liệt kê các đợt dữ liệu (batch) gần đây ----
async function listBatches() {
  const rows = await dbAll('SELECT id, thang, status, created_at FROM batches ORDER BY id DESC LIMIT 10');
  return rows;
}

// ---- Tool 2: xem chi tiết 1 batch (đã phân tích chưa, đã xác nhận chưa) ----
async function getBatchStatus({ batchId }) {
  const batch = await dbGet('SELECT * FROM batches WHERE id = ?', [batchId]);
  if (!batch) return { error: `Không tìm thấy batch #${batchId}` };
  const analysis = await dbGet('SELECT * FROM analysis WHERE batch_id = ?', [batchId]);
  return {
    batch,
    hasDraft: !!analysis,
    hasConfirmedReport: !!(analysis && analysis.report_path),
  };
}

// ---- Tool 3: chạy AI phân tích 1 batch -> ra bản ĐỀ XUẤT (chưa phải báo cáo chính thức) ----
async function runAnalyze({ batchId }) {
  const batch = await dbGet('SELECT * FROM batches WHERE id = ?', [batchId]);
  if (!batch) return { error: `Không tìm thấy batch #${batchId}` };

  const filesRaw = await dbAll('SELECT * FROM files WHERE batch_id = ?', [batchId]);
  const files = filesRaw.map((f) => ({
    ...f,
    filepath: path.join(UPLOAD_ROOT, String(batchId), f.filename),
  }));

  const draft = await analyze(files, batch.thang);

  await dbRun(
    `INSERT INTO analysis (batch_id, draft_json) VALUES (?, ?)
     ON CONFLICT(batch_id) DO UPDATE SET draft_json = excluded.draft_json`,
    [batchId, JSON.stringify(draft)]
  );
  await dbRun(`UPDATE batches SET status = 'analyzed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [batchId]);

  return { batchId, status: 'analyzed', draft, note: 'Đây là bản đề xuất, cần xác nhận (confirm_batch) mới phát hành chính thức.' };
}

// ---- Tool 4: XÁC NHẬN phát hành báo cáo chính thức -> tạo file Word thật ----
// Đây là hành động GHI thật -> luôn cần xác nhận qua chat.
async function confirmBatch({ batchId }) {
  const batch = await dbGet('SELECT * FROM batches WHERE id = ?', [batchId]);
  if (!batch) return { error: `Không tìm thấy batch #${batchId}` };

  const analysisRow = await dbGet('SELECT * FROM analysis WHERE batch_id = ?', [batchId]);
  if (!analysisRow) return { error: 'Chưa có bản đề xuất, cần chạy phân tích (run_analyze) trước.' };

  const finalData = JSON.parse(analysisRow.draft_json);
  const outPath = await generateReportFile(finalData, REPORT_ROOT);

  await dbRun('UPDATE analysis SET confirmed_json = ?, report_path = ? WHERE batch_id = ?', [
    JSON.stringify(finalData),
    outPath,
    batchId,
  ]);
  await dbRun(`UPDATE batches SET status = 'confirmed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [batchId]);

  return { batchId, status: 'confirmed', report_path: outPath };
}

// ---- Khai báo cho LLM ----
const toolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'list_batches',
      description: 'Liệt kê các đợt dữ liệu (batch) QC gần đây và trạng thái xử lý.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_batch_status',
      description: 'Xem trạng thái chi tiết của một batch: đã phân tích chưa, đã có báo cáo chính thức chưa.',
      parameters: {
        type: 'object',
        properties: { batchId: { type: 'number', description: 'ID batch' } },
        required: ['batchId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_analyze',
      description: 'Chạy AI phân tích dữ liệu thô của một batch để ra bản đề xuất báo cáo QC.',
      parameters: {
        type: 'object',
        properties: { batchId: { type: 'number', description: 'ID batch' } },
        required: ['batchId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'confirm_batch',
      description: 'Xác nhận phát hành báo cáo QC chính thức (tạo file Word thật) từ bản đề xuất đã có. Đây là hành động ghi dữ liệu thật, luôn cần người dùng xác nhận.',
      parameters: {
        type: 'object',
        properties: { batchId: { type: 'number', description: 'ID batch' } },
        required: ['batchId'],
      },
    },
  },
];

const toolRegistry = {
  list_batches: { handler: listBatches, requiresConfirmation: false },
  get_batch_status: { handler: getBatchStatus, requiresConfirmation: false },
  run_analyze: { handler: runAnalyze, requiresConfirmation: false },
  confirm_batch: { handler: confirmBatch, requiresConfirmation: true },
};

module.exports = { toolDefinitions, toolRegistry };
