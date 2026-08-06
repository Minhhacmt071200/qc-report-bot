const XLSX = require('xlsx');
const mammoth = require('mammoth');
const path = require('path');
const fs = require('fs');

/** Đọc 1 file bất kỳ và trả về text thuần để đưa vào AI phân tích */
async function extractText(filepath) {
  const ext = path.extname(filepath).toLowerCase();

  if (ext === '.xlsx' || ext === '.xls' || ext === '.csv') {
    const wb = XLSX.readFile(filepath);
    let out = '';
    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(sheet);
      out += `\n--- Sheet: ${sheetName} ---\n${csv}\n`;
    }
    return out;
  }

  if (ext === '.docx') {
    const { value } = await mammoth.extractRawText({ path: filepath });
    return value;
  }

  if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
    // Ảnh: không OCR bằng thư viện riêng — sẽ được gửi trực tiếp cho Claude Vision
    // đọc nội dung (xem analyze.js). Text này chỉ dùng cho chế độ fallback rule-based.
    return `[ẢNH ĐÍNH KÈM: ${path.basename(filepath)} - nội dung sẽ được AI đọc trực tiếp qua Vision nếu có ANTHROPIC_API_KEY]`;
  }

  if (ext === '.txt') {
    return fs.readFileSync(filepath, 'utf-8');
  }

  return `[Không hỗ trợ đọc tự động định dạng ${ext}: ${path.basename(filepath)}]`;
}

const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp'];
function isImage(filepath) {
  return IMAGE_EXT.includes(path.extname(filepath).toLowerCase());
}

function imageMediaType(filepath) {
  const ext = path.extname(filepath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

module.exports = { extractText, isImage, imageMediaType };
