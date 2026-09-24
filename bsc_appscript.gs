// ============================================================
//  BSC Maintenance Form — Google Apps Script
//  วิธีใช้:
//    1. เปิด Google Sheets → Extensions → Apps Script
//    2. ลบโค้ดเดิมทั้งหมด → วางโค้ดนี้
//    3. Deploy → New Deployment → Web app
//       Execute as: Me  |  Who has access: Anyone
//    4. คัดลอก Web app URL → วางใน BSC Form (ปุ่ม ⚙️)
// ============================================================

/**
 * รับ POST จาก BSC Maintenance Form
 * body (text/plain JSON): { rows: string[][], month: string, sheetName: string }
 */
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const ss      = SpreadsheetApp.getActiveSpreadsheet();
    const tabName = payload.sheetName || payload.month || 'BSC';

    // หา tab หรือสร้างใหม่
    let sheet = ss.getSheetByName(tabName);
    if (!sheet) {
      sheet = ss.insertSheet(tabName);
    } else {
      sheet.clearContents();
      sheet.clearFormats();
    }

    // เขียนข้อมูล
    if (payload.rows && payload.rows.length > 0) {
      const numCols = Math.max(...payload.rows.map(r => r.length));
      // ทำให้ทุกแถวมีจำนวน column เท่ากัน
      const normalized = payload.rows.map(r => {
        const row = [...r];
        while (row.length < numCols) row.push('');
        return row;
      });
      const numRows = normalized.length;
      const range = sheet.getRange(1, 1, numRows, numCols);
      range.setValues(normalized);

      const headerRowIndex = normalized.findIndex(r => r[0] === 'รายการ') + 1;
      const inspRowIndex   = normalized.findIndex(r => r[0] === 'ผู้ตรวจสอบ') + 1;

      // สร้าง array รูปแบบทั้งชีตไว้ล่วงหน้า แล้วเซตทีเดียวทั้งช่วง
      // (เดิมวนเซต setBackground/setFontWeight ทีละเซลล์ ซึ่งแต่ละครั้งคือ
      //  1 round-trip ไปยัง Sheets service — ตารางที่มี ~30 คอลัมน์ x หลายสิบแถว
      //  กลายเป็นหลายร้อย/พันคำขอ และนี่คือสาเหตุหลักที่บันทึกช้ามาก)
      const backgrounds = normalized.map(() => new Array(numCols).fill(null));
      const fontColors   = normalized.map(() => new Array(numCols).fill(null));
      const fontWeights  = normalized.map(() => new Array(numCols).fill('normal'));

      // แถวหัว (แถวแรก)
      for (let j = 0; j < numCols; j++) {
        backgrounds[0][j] = '#1d4ed8';
        fontColors[0][j]  = '#ffffff';
        fontWeights[0][j] = 'bold';
      }

      // แถว column headers (วันที่)
      if (headerRowIndex > 0) {
        const r = headerRowIndex - 1;
        for (let j = 0; j < numCols; j++) {
          backgrounds[r][j] = '#1e40af';
          fontColors[r][j]  = '#ffffff';
          fontWeights[r][j] = 'bold';
        }
      }

      // ไฮไลต์ช่องที่มีเครื่องหมาย /
      for (let i = 0; i < numRows; i++) {
        for (let j = 1; j < numCols; j++) {
          if (normalized[i][j] === '/') {
            backgrounds[i][j] = '#d1fae5';
            fontWeights[i][j] = 'bold';
          }
        }
      }

      // ไฮไลต์ช่องผู้ตรวจสอบที่เซ็นแล้ว
      if (inspRowIndex > 0) {
        const r = inspRowIndex - 1;
        for (let j = 1; j < numCols; j++) {
          if (normalized[r][j] === '✓') backgrounds[r][j] = '#bfdbfe';
        }
      }

      range.setBackgrounds(backgrounds);
      range.setFontColors(fontColors);
      range.setFontWeights(fontWeights);
      sheet.getRange(1, 1, 1, numCols).setFontSize(10);

      // ล็อกความกว้างคอลัมน์ (แบตช์เดียวแทนการวนทีละคอลัมน์)
      sheet.setColumnWidth(1, 280);
      if (numCols > 1) sheet.setColumnWidths(2, numCols - 1, 36);

      // freeze row headers
      if (headerRowIndex > 0) sheet.setFrozenRows(headerRowIndex);
      sheet.setFrozenColumns(1);
    }

    // บันทึก log วันเวลาที่อัปเดต
    const logSheet = ss.getSheetByName('_log') || ss.insertSheet('_log');
    logSheet.appendRow([new Date(), tabName, 'บันทึกสำเร็จ', payload.rows?.length + ' แถว']);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, tab: tabName }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/** ทดสอบว่า script พร้อมใช้งาน */
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'BSC Maintenance Script ready ✓' }))
    .setMimeType(ContentService.MimeType.JSON);
}
