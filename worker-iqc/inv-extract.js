// อ่านภาพเอกสารจัดซื้อน้ำยา/เวชภัณฑ์ (ใบสั่งซื้อ/ใบส่งของ/ใบรับสินค้า) ด้วย Workers AI
// แล้วแปลงเป็นหัวเอกสาร + รายการบรรทัด ให้หน้า inventory.html เอาไปเติมในฟอร์มเดิมให้ผู้ใช้ตรวจสอบ/แก้ไขก่อนกดบันทึกเอง
// (endpoint นี้ไม่เขียนอะไรลง D1 — คืนแค่ข้อมูลที่อ่านได้ ฟอร์มเดิมเป็นคนบันทึกจริง)
// ใช้ pipeline เดียวกับ gpf-extract.js / stock-extract.js ของแดชบอร์ดอีกตัว: ถอดข้อความก่อน แล้วค่อยแปลงเป็น JSON

const TRANSCRIBE_PROMPT = `นี่คือภาพถ่ายหรือภาพแคปหน้าจอของเอกสารจัดซื้อน้ำยา/เวชภัณฑ์ของห้องปฏิบัติการ อาจเป็นใบสั่งซื้อ (Purchase Order) ใบส่งของ/ใบกำกับภาษี (Invoice/Delivery Note) หรือใบรับสินค้า (Goods Receipt) อย่างใดอย่างหนึ่ง
กรุณาถอดข้อความและตัวเลขทั้งหมดที่เห็นในภาพให้ครบถ้วนที่สุด ทีละบรรทัดตามลำดับที่ปรากฏในภาพ รวมถึงเลขที่เอกสาร วันที่ ชื่อบริษัท/ผู้ขาย และตารางรายการสินค้าทุกแถว (ชื่อสินค้า/น้ำยา, จำนวน, หน่วย, ราคาต่อหน่วย, ราคารวม, Lot No., วันหมดอายุ, กำหนดส่ง)
ไม่ต้องตีความ ไม่ต้องสรุป ไม่ต้องแปลง ไม่ต้องคำนวณอะไรทั้งสิ้น แค่บอกว่าเห็นข้อความ/ตัวเลขอะไรบ้างในแต่ละแถว`;

const PARSE_PROMPT = `ต่อไปนี้คือข้อความที่ถอดมาจากภาพเอกสารจัดซื้อน้ำยา/เวชภัณฑ์ของห้องปฏิบัติการ (ใบสั่งซื้อ/ใบส่งของ/ใบรับสินค้า):

---
{TRANSCRIPT}
---

แปลงข้อมูลข้างต้นเป็น JSON เท่านั้น (ห้ามมีข้อความอื่นนอกจาก JSON) ตามรูปแบบนี้:

{
  "doc_number": "เลขที่เอกสาร (เลขที่ PO หรือเลขที่ใบส่งของ/invoice ตามที่เห็นจริงในภาพ ถ้าไม่เจอให้เป็น null)",
  "doc_date": "วันที่ของเอกสาร แปลงเป็นรูปแบบ YYYY-MM-DD เท่านั้น โดยต้องแปลงปี พ.ศ. เป็น ค.ศ. ด้วยการลบ 543 เสมอ (เช่น 2569 → 2026) และแปลงชื่อเดือนภาษาไทยเป็นเลข ถ้าไม่เจอวันที่เลยให้ตอบ null ห้ามเดาหรือใช้วันที่ปัจจุบันแทน",
  "supplier_name": "ชื่อบริษัท/ผู้ขาย (ถ้าไม่เจอให้เป็น null)",
  "note": "หมายเหตุหัวเอกสารถ้ามี (ถ้าไม่เจอให้เป็น null)",
  "items": [
    {
      "product_name": "ชื่อสินค้า/น้ำยา/วัสดุ ตามที่เห็นในภาพ",
      "category": "หมวดหมู่ถ้าระบุไว้ (ถ้าไม่เจอให้เป็น null)",
      "quantity": ตัวเลขจำนวนที่สั่ง/ส่ง (ถ้าไม่เจอให้เป็น null),
      "unit": "หน่วย เช่น กล่อง, ขวด, ชุด (ถ้าไม่เจอให้เป็น null)",
      "unit_price": ตัวเลขราคาต่อหน่วย ไม่มีคอมมา (ถ้าไม่เจอให้เป็น null),
      "total_price": ตัวเลขราคารวมของบรรทัดนี้ ไม่มีคอมมา (ถ้าไม่เจอให้เป็น null),
      "lot": "เลข Lot No. ถ้ามี (ถ้าไม่เจอให้เป็น null)",
      "exp_date": "วันหมดอายุของบรรทัดนี้ แปลงเป็น YYYY-MM-DD (แปลงปี พ.ศ.→ค.ศ. ด้วยการลบ 543 เสมอ) ถ้าไม่เจอให้เป็น null",
      "due_date": "วันกำหนดส่งของบรรทัดนี้ถ้ามี แปลงเป็น YYYY-MM-DD เช่นเดียวกัน ถ้าไม่เจอให้เป็น null"
    }
  ]
}

กฎสำคัญ: หนึ่งแถวในตารางสินค้าสร้างรายการใน items แค่ 1 รายการ ห้ามสร้างซ้ำ ถ้าแถวไหนไม่มีชื่อสินค้าให้ข้ามแถวนั้นไป

ตอบเฉพาะ JSON เท่านั้น ห้ามใส่ markdown code fence หรือคำอธิบายอื่น`;

function extractJson(text) {
  if (text && typeof text === 'object') return text; // Workers AI บางครั้ง parse JSON ให้อัตโนมัติแล้ว
  if (typeof text !== 'string') return null;
  const start = text.indexOf('{');
  if (start === -1) return null;

  // หาตำแหน่งปิดของ JSON object แรกด้วยการนับความลึกวงเล็บปีกกา (โมเดลบางครั้งพ่นข้อความซ้ำต่อท้าย
  // หลังตอบ JSON ที่ถูกต้องแล้ว การหา '}' ตัวสุดท้ายในสตริงทั้งหมดจะจับขยะนั้นมาด้วย)
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); }
        catch { return null; }
      }
    }
  }
  return null;
}

function toNumberOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toDateOrNull(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

function strOrNull(v, max = 200) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

async function extractPurchaseDoc(imageBytes, env) {
  const visionRes = await env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct', {
    image: [...imageBytes],
    prompt: TRANSCRIBE_PROMPT,
    max_tokens: 1536,
    temperature: 0.1,
  });
  const transcript = typeof visionRes?.response === 'string' ? visionRes.response : JSON.stringify(visionRes?.response || '');
  if (!transcript.trim()) {
    throw new Error('อ่านข้อความจากภาพไม่สำเร็จ กรุณาลองภาพอื่นหรือกรอกเอง');
  }

  const parseRes = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast', {
    prompt: PARSE_PROMPT.replace('{TRANSCRIPT}', transcript),
    max_tokens: 1536,
    temperature: 0.1,
  });

  const parsed = extractJson(parseRes && parseRes.response);
  if (!parsed) {
    throw new Error('แปลงข้อมูลจากภาพเป็นรายการไม่สำเร็จ กรุณาลองภาพอื่นหรือกรอกเอง');
  }

  const items = Array.isArray(parsed.items)
    ? parsed.items
        .map((it) => ({
          product_name: strOrNull(it && it.product_name, 200) || '',
          category: strOrNull(it && it.category, 60),
          quantity: toNumberOrNull(it && it.quantity),
          unit: strOrNull(it && it.unit, 30),
          unit_price: toNumberOrNull(it && it.unit_price),
          total_price: toNumberOrNull(it && it.total_price),
          lot: strOrNull(it && it.lot, 60),
          exp_date: toDateOrNull(it && it.exp_date),
          due_date: toDateOrNull(it && it.due_date),
        }))
        .filter((it) => it.product_name)
    : [];

  if (!items.length) {
    throw new Error('ไม่พบรายการสินค้าในภาพ กรุณาลองภาพที่ชัดเจนกว่านี้ หรือกรอกเอง');
  }

  return {
    doc_number: strOrNull(parsed.doc_number, 60),
    doc_date: toDateOrNull(parsed.doc_date),
    supplier_name: strOrNull(parsed.supplier_name, 120),
    note: strOrNull(parsed.note, 300),
    items,
  };
}

export { extractPurchaseDoc };
