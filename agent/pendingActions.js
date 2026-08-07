// agent/pendingActions.js
// Hành động GHI (vd: xác nhận phát hành báo cáo) không chạy ngay -
// lưu vào chat_pending, chờ người dùng gõ "xác nhận" mới thực thi.

const db = require('../db');

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      err ? reject(err) : resolve(this);
    });
  });
}

async function setPending(sessionId, toolName, payload) {
  await dbRun(
    `INSERT INTO chat_pending (session_id, tool_name, payload) VALUES (?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET tool_name = excluded.tool_name,
       payload = excluded.payload, created_at = CURRENT_TIMESTAMP`,
    [sessionId, toolName, JSON.stringify(payload)]
  );
}

async function getPending(sessionId) {
  return dbGet(`SELECT * FROM chat_pending WHERE session_id = ?`, [sessionId]);
}

async function clearPending(sessionId) {
  await dbRun(`DELETE FROM chat_pending WHERE session_id = ?`, [sessionId]);
}

module.exports = { setPending, getPending, clearPending };
