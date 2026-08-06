const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow,
  TableCell, WidthType, ShadingType, AlignmentType, BorderStyle,
} = require('docx');
const fs = require('fs');
const path = require('path');

function scoreColor(diem) {
  if (diem >= 90) return 'C6EFCE';
  if (diem >= 75) return 'FFEB9C';
  if (diem >= 60) return 'FFD9B3';
  return 'FFC7CE';
}

function buildReport(data) {
  const tableWidth = 9360; // DXA, tổng cho A4 với margin thường
  const colWidths = [2200, 1000, 1400, 2600, 2160];

  const headerRow = new TableRow({
    tableHeader: true,
    children: ['Siêu thị', 'Điểm', 'Xếp loại', 'Vấn đề nổi bật', 'Đề xuất'].map(
      (t, i) =>
        new TableCell({
          width: { size: colWidths[i], type: WidthType.DXA },
          shading: { type: ShadingType.CLEAR, fill: 'D9D9D9' },
          children: [new Paragraph({ children: [new TextRun({ text: t, bold: true })] })],
        })
    ),
  });

  const dataRows = (data.sieu_thi || []).map(
    (r) =>
      new TableRow({
        children: [
          new TableCell({ width: { size: colWidths[0], type: WidthType.DXA }, children: [new Paragraph(r.ten || '')] }),
          new TableCell({
            width: { size: colWidths[1], type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, fill: scoreColor(r.diem || 0) },
            children: [new Paragraph(String(r.diem ?? ''))],
          }),
          new TableCell({ width: { size: colWidths[2], type: WidthType.DXA }, children: [new Paragraph(r.xep_loai || '')] }),
          new TableCell({ width: { size: colWidths[3], type: WidthType.DXA }, children: [new Paragraph(r.van_de_noi_bat || '')] }),
          new TableCell({ width: { size: colWidths[4], type: WidthType.DXA }, children: [new Paragraph(r.de_xuat || '')] }),
        ],
      })
  );

  const bulletPara = (text) =>
    new Paragraph({ text, numbering: { reference: 'bullet-list', level: 0 } });

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: 'bullet-list',
          levels: [{ level: 0, format: 'bullet', text: '•', alignment: AlignmentType.LEFT }],
        },
      ],
    },
    sections: [
      {
        properties: { page: { size: { width: 11906, height: 16838 } } }, // A4
        children: [
          new Paragraph({
            text: `BÁO CÁO CHẤM ĐIỂM DỊCH VỤ CHUỖI SIÊU THỊ - THÁNG ${data.thang}`,
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
          }),
          new Paragraph({ text: '' }),
          new Paragraph({ text: '1. Tổng quan', heading: HeadingLevel.HEADING_2 }),
          new Paragraph({ text: data.tong_quan || '' }),
          new Paragraph({
            children: [
              new TextRun({ text: 'Điểm trung bình toàn chuỗi: ', bold: true }),
              new TextRun({ text: String(data.diem_trung_binh_toan_chuoi ?? 'N/A') }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({ text: 'Xu hướng so với tháng trước: ', bold: true }),
              new TextRun({ text: data.xu_huong_so_voi_thang_truoc || 'N/A' }),
            ],
          }),
          new Paragraph({ text: '' }),

          new Paragraph({ text: '2. Chi tiết theo siêu thị', heading: HeadingLevel.HEADING_2 }),
          new Table({
            width: { size: tableWidth, type: WidthType.DXA },
            columnWidths: colWidths,
            rows: [headerRow, ...dataRows],
          }),
          new Paragraph({ text: '' }),

          new Paragraph({ text: '3. Top 3 siêu thị tốt nhất', heading: HeadingLevel.HEADING_2 }),
          ...(data.top_3_tot_nhat || []).map(bulletPara),
          new Paragraph({ text: '' }),

          new Paragraph({ text: '4. Top 3 siêu thị cần cải thiện', heading: HeadingLevel.HEADING_2 }),
          ...(data.top_3_can_cai_thien || []).map(bulletPara),
          new Paragraph({ text: '' }),

          new Paragraph({ text: '5. Đề xuất hành động', heading: HeadingLevel.HEADING_2 }),
          ...(data.de_xuat_hanh_dong || []).map(bulletPara),

          new Paragraph({ text: '' }),
          new Paragraph({
            children: [
              new TextRun({
                text: `Báo cáo được tạo tự động bởi QC Report Bot, đã qua bước xác nhận của người dùng trước khi phát hành.`,
                italics: true,
                color: '888888',
              }),
            ],
          }),
        ],
      },
    ],
  });

  return doc;
}

async function generateReportFile(data, outDir) {
  const doc = buildReport(data);
  const buffer = await Packer.toBuffer(doc);
  fs.mkdirSync(outDir, { recursive: true });
  const filename = `BaoCao_ChamDiemDichVu_${data.thang}.docx`;
  const outPath = path.join(outDir, filename);
  fs.writeFileSync(outPath, buffer);
  return outPath;
}

module.exports = { generateReportFile };
