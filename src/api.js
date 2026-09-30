import { API_URL } from "./config";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * ทุก action ตอบ "state ล่าสุด" กลับมา -> {dashboard, members, transactions}
 * - action อ่าน (all) retry ให้เองสูงสุด 3 ครั้ง
 * - action เขียน ไม่ retry (กันบันทึกซ้ำ) ถ้าตอบผิดรูปแบบจะมี err.uncertain = true
 */
async function call(action, data = {}) {
  if (!API_URL || API_URL.includes("PASTE_YOUR")) {
    throw new Error("กรุณาตั้งค่า API_URL ใน src/config.js");
  }

  const params = new URLSearchParams({ action });
  for (const [k, v] of Object.entries(data)) {
    params.set(k, typeof v === "object" ? JSON.stringify(v) : String(v ?? ""));
  }

  const isRead = action === "all";
  const maxTry = isRead ? 3 : 1;
  let lastErr;

  for (let attempt = 1; attempt <= maxTry; attempt++) {
    try {
      const res = await fetch(`${API_URL}?${params}`);
      const text = await res.text();

      let json;
      try {
        json = JSON.parse(text);
      } catch {
        console.warn(`[api] ไม่ใช่ JSON (ครั้งที่ ${attempt}) status=${res.status}`, text.slice(0, 300));
        const err = new Error(
          isRead
            ? "เซิร์ฟเวอร์ตอบกลับผิดรูปแบบ ลองรีเฟรชอีกครั้ง"
            : "ไม่แน่ใจว่าบันทึกสำเร็จหรือไม่ กำลังโหลดข้อมูลล่าสุดให้ตรวจสอบ"
        );
        err.uncertain = !isRead;
        throw err;
      }

      if (!json.ok) {
        const err = new Error(json.message || "API error");
        err.fatal = true; // error จากตรรกะของสคริปต์ ไม่ retry
        throw err;
      }
      return json.data;
    } catch (e) {
      lastErr = e;
      if (e.fatal || attempt === maxTry) break;
      await sleep(600 * attempt);
    }
  }

  if (lastErr instanceof TypeError) lastErr = new Error("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่");
  throw lastErr;
}

export const api = {
  all: () => call("all"),
  addMember: (name) => call("addMember", { name }),
  deleteMember: (memberId) => call("deleteMember", { memberId }),
  addDeposit: (memberId, amount, note) => call("addDeposit", { memberId, amount, note }),
  addDeposits: (memberIds, amount, note) => call("addDeposits", { memberIds, amount, note }),
  addExpense: (amount, note, allocations) => call("addExpense", { amount, note, allocations }),
  addWithdrawal: (memberId, amount, note) => call("addWithdrawal", { memberId, amount, note }),
};

/* แคชในเครื่อง: เปิดเว็บมาเห็นข้อมูลล่าสุดที่เคยโหลดทันที แล้วค่อยอัปเดตเบื้องหลัง */
const KEY = "group-wallet-state-v2";
export function loadCache() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || null;
  } catch {
    return null;
  }
}
export function saveCache(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}
