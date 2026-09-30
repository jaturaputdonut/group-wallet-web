import React, { useCallback, useEffect, useRef, useState } from "react";
import { api, loadCache, saveCache } from "./api";

const money = (n) =>
  new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    maximumFractionDigits: 2,
  }).format(Number(n || 0));

const dateText = (value) => {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("th-TH", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
};

const TABS = [
  ["dashboard", "ภาพรวม"],
  ["members", "สมาชิก"],
  ["deposit", "ฝากเงิน"],
  ["expense", "ใช้เงิน"],
  ["withdraw", "เบิกเงิน"],
  ["history", "ประวัติ"],
];

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [state, setState] = useState(loadCache); // แสดงข้อมูลเก่าทันที
  const [syncing, setSyncing] = useState(0);
  const [writing, setWriting] = useState(false);
  const [toast, setToast] = useState(null);
  const [error, setError] = useState("");
  const timer = useRef();
  const started = useRef(false);

  const flash = useCallback((msg, type = "ok") => {
    setToast({ msg, type });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), type === "ok" ? 2200 : 4500);
  }, []);

  const apply = useCallback((s) => {
    setState(s);
    saveCache(s);
  }, []);

  const refresh = useCallback(async () => {
    setSyncing((n) => n + 1);
    setError("");
    try {
      apply(await api.all());
    } catch (e) {
      setError(e.message);
    } finally {
      setSyncing((n) => n - 1);
    }
  }, [apply]);

  useEffect(() => {
    if (started.current) return; // กัน StrictMode ยิงซ้ำตอน dev
    started.current = true;
    refresh();
  }, [refresh]);

  // รัน action เขียน: สำเร็จ -> ได้ state ใหม่กลับมาเลย ไม่ต้อง reload
  const run = useCallback(
    async (fn, okMsg) => {
      setWriting(true);
      try {
        apply(await fn());
        if (okMsg) flash(okMsg);
        return true;
      } catch (e) {
        flash(e.message, "err");
        if (e.uncertain) refresh();
        return false;
      } finally {
        setWriting(false);
      }
    },
    [apply, flash, refresh]
  );

  const deleteMember = async (m) => {
    const prev = state;
    setState((s) => ({ ...s, members: s.members.filter((x) => x.id !== m.id) })); // หายจากจอทันที
    const ok = await run(() => api.deleteMember(m.id), "ลบสมาชิกแล้ว");
    if (!ok) setState(prev);
  };

  const members = state?.members ?? [];
  const ctx = { members, run, writing, flash };

  return (
    <div className="app">
      <div className={"topbar" + (syncing > 0 || writing ? " on" : "")} />

      <header>
        <div>
          <div className="brand">💰 Group Wallet</div>
          <div className="subtitle">กองกลางกิน / เที่ยวของกลุ่ม</div>
        </div>
        <button className="refresh" onClick={refresh} disabled={syncing > 0}>
          {syncing > 0 ? "กำลังโหลด..." : "↻ รีเฟรช"}
        </button>
      </header>

      {error && (
        <div className="error">
          {error} <button className="link" onClick={refresh}>ลองใหม่</button>
        </div>
      )}

      <nav className="tabs">
        {TABS.map(([key, label]) => (
          <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </nav>

      <main>
        {!state ? (
          <div className="loading">กำลังโหลดข้อมูล...</div>
        ) : (
          <>
            {tab === "dashboard" && <Dashboard dashboard={state.dashboard} members={members} />}
            {tab === "members" && <Members {...ctx} onDelete={deleteMember} />}
            {tab === "deposit" && <Deposit {...ctx} />}
            {tab === "expense" && <Expense {...ctx} />}
            {tab === "withdraw" && <Withdraw {...ctx} />}
            {tab === "history" && <History transactions={state.transactions} />}
          </>
        )}
      </main>

      {toast && <div className={"toast " + toast.type}>{toast.msg}</div>}
    </div>
  );
}

/* ---------- Dashboard ---------- */

function Dashboard({ dashboard, members }) {
  return (
    <>
      <section className="cards">
        <Card title="เงินฝากทั้งหมด" value={money(dashboard?.totalDeposit)} />
        <Card title="ค่าใช้จ่ายทั้งหมด" value={money(dashboard?.totalExpense)} />
        <Card title="เงินเบิกทั้งหมด" value={money(dashboard?.totalWithdrawal)} />
        <Card title="💰 กองกลางคงเหลือ" value={money(dashboard?.balance)} highlight />
      </section>

      <section className="panel">
        <h2>ยอดของสมาชิก</h2>
        <div className="member-grid">
          {members.map((m) => (
            <div className="member-card" key={m.id}>
              <div className="member-name">👤 {m.name}</div>
              <div className="member-row"><span>ฝาก</span><b>{money(m.deposit)}</b></div>
              <div className="member-row"><span>ส่วนแบ่งค่าใช้จ่าย</span><b>-{money(m.expense)}</b></div>
              <div className="member-row"><span>เบิก</span><b>-{money(m.withdrawal)}</b></div>
              <div className="member-total"><span>เหลือ</span><strong>{money(m.balance)}</strong></div>
            </div>
          ))}
          {!members.length && <div className="empty">ยังไม่มีสมาชิก</div>}
        </div>
      </section>
    </>
  );
}

function Card({ title, value, highlight }) {
  return (
    <div className={`stat ${highlight ? "highlight" : ""}`}>
      <span>{title}</span>
      <strong>{value}</strong>
    </div>
  );
}

/* ---------- Members ---------- */

function Members({ members, run, writing, onDelete }) {
  const [name, setName] = useState("");

  const add = async (e) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    if (await run(() => api.addMember(n), "เพิ่มสมาชิกแล้ว")) setName("");
  };

  const remove = (m) => {
    if (Math.abs(m.balance) > 0.001) {
      alert(`"${m.name}" ยังมียอดคงเหลือ ${money(m.balance)}\nกรุณาเคลียร์ให้เป็น 0 ก่อนลบ`);
      return;
    }
    if (window.confirm(`ลบ "${m.name}" ออกจากกลุ่ม?`)) onDelete(m);
  };

  return (
    <section className="panel">
      <h2>สมาชิก</h2>
      <form className="inline-form" onSubmit={add}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ชื่อเพื่อน" />
        <button disabled={writing}>{writing ? "กำลังบันทึก..." : "+ เพิ่มสมาชิก"}</button>
      </form>
      <div className="list">
        {members.map((m) => (
          <div className="list-row" key={m.id}>
            <span>👤 {m.name}</span>
            <span className="row-right">
              <strong>{money(m.balance)}</strong>
              <button type="button" className="danger" onClick={() => remove(m)}>ลบ</button>
            </span>
          </div>
        ))}
        {!members.length && <div className="empty">ยังไม่มีสมาชิก</div>}
      </div>
    </section>
  );
}

/* ---------- Deposit ---------- */

function Deposit({ members, run, writing, flash }) {
  const [selected, setSelected] = useState([]);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const ids = members.filter((m) => selected.includes(m.id)).map((m) => m.id);
  const each = Number(amount || 0);
  const allSelected = members.length > 0 && selected.length === members.length;

  const submit = async (e) => {
    e.preventDefault();
    if (!ids.length) return flash("เลือกคนฝากอย่างน้อย 1 คน", "err");
    if (each <= 0) return flash("กรอกจำนวนเงิน", "err");
    const ok = await run(
      () => api.addDeposits(ids, each, note),
      ids.length > 1 ? `บันทึกเงินฝาก ${ids.length} คนแล้ว` : "บันทึกเงินฝากแล้ว"
    );
    if (ok) { setAmount(""); setNote(""); setSelected([]); }
  };

  return (
    <Form title="ฝากเงินเข้ากองกลาง" onSubmit={submit} writing={writing} submitText="บันทึกเงินฝาก">
      <div className="row-between">
        <label style={{ margin: 0 }}>คนฝาก (เลือกได้หลายคน)</label>
        <button type="button" className="link" onClick={() => setSelected(allSelected ? [] : members.map((m) => m.id))}>
          {allSelected ? "ล้างทั้งหมด" : "เลือกทั้งหมด"}
        </button>
      </div>
      <div className="checks">
        {members.map((m) => (
          <label className="check" key={m.id}>
            <input type="checkbox" checked={selected.includes(m.id)} onChange={() => toggle(m.id)} />
            {m.name}
          </label>
        ))}
        {!members.length && <div className="empty">ยังไม่มีสมาชิก</div>}
      </div>

      <Input label="จำนวนเงินต่อคน" type="number" inputMode="decimal" value={amount} onChange={setAmount} />
      {ids.length > 0 && each > 0 && (
        <div className="preview">
          {ids.length} คน × {money(each)} = <b>{money(ids.length * each)}</b>
        </div>
      )}
      <Input label="หมายเหตุ" value={note} onChange={setNote} placeholder="เช่น โอนเข้ากองกลาง" />
    </Form>
  );
}

/* ---------- Expense ---------- */

// หารเท่ากันแบบไม่เศษหาย (เศษสตางค์กระจายให้คนแรกๆ)
function splitEqual(total, ids) {
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / ids.length);
  const extra = cents - base * ids.length;
  return ids.map((memberId, i) => ({ memberId, amount: (base + (i < extra ? 1 : 0)) / 100 }));
}

function Expense({ members, run, writing, flash }) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [mode, setMode] = useState("equal");
  const [selected, setSelected] = useState([]);
  const [custom, setCustom] = useState({});

  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const ids = members.filter((m) => selected.includes(m.id)).map((m) => m.id);
  const total = Number(amount || 0);
  const customSum = ids.reduce((s, id) => s + Number(custom[id] || 0), 0);

  const submit = async (e) => {
    e.preventDefault();
    if (total <= 0) return flash("กรอกจำนวนเงิน", "err");
    if (!ids.length) return flash("เลือกสมาชิกอย่างน้อย 1 คน", "err");

    const allocations =
      mode === "equal"
        ? splitEqual(total, ids)
        : ids.map((id) => ({ memberId: id, amount: Number(custom[id] || 0) }));

    const sum = allocations.reduce((a, x) => a + x.amount, 0);
    if (Math.abs(sum - total) > 0.011)
      return flash(`ยอดแบ่งรวม ${sum.toFixed(2)} ไม่เท่ากับ ${total.toFixed(2)}`, "err");

    const ok = await run(() => api.addExpense(total, note, allocations), "บันทึกค่าใช้จ่ายแล้ว");
    if (ok) { setAmount(""); setNote(""); setSelected([]); setCustom({}); }
  };

  return (
    <Form title="ใช้เงินกองกลาง" onSubmit={submit} writing={writing} submitText="บันทึกค่าใช้จ่าย">
      <Input label="จำนวนเงิน" type="number" inputMode="decimal" value={amount} onChange={setAmount} />
      <Input label="รายการ" value={note} onChange={setNote} placeholder="เช่น บุฟเฟต์ / ค่าน้ำมัน" />

      <Select
        label="วิธีแบ่ง"
        value={mode}
        onChange={setMode}
        options={[["equal", "หารเท่ากัน"], ["custom", "กำหนดยอดแต่ละคน"]]}
        noEmpty
      />

      <div className="row-between">
        <label style={{ margin: 0 }}>คนที่ร่วมจ่าย</label>
        <button
          type="button"
          className="link"
          onClick={() => setSelected(selected.length === members.length ? [] : members.map((m) => m.id))}
        >
          {selected.length === members.length ? "ล้างทั้งหมด" : "เลือกทั้งหมด"}
        </button>
      </div>

      <div className="checks">
        {members.map((m) => (
          <label className="check" key={m.id}>
            <input type="checkbox" checked={selected.includes(m.id)} onChange={() => toggle(m.id)} />
            {m.name}
            {mode === "custom" && selected.includes(m.id) && (
              <input
                type="number"
                inputMode="decimal"
                placeholder="ยอด"
                value={custom[m.id] ?? ""}
                onChange={(e) => setCustom((c) => ({ ...c, [m.id]: e.target.value }))}
              />
            )}
          </label>
        ))}
      </div>

      {mode === "equal" && ids.length > 0 && total > 0 && (
        <div className="preview">คนละ ~{money(total / ids.length)}</div>
      )}
      {mode === "custom" && ids.length > 0 && (
        <div className={"preview" + (Math.abs(customSum - total) > 0.011 ? " warn" : "")}>
          รวม {money(customSum)} / {money(total)}
        </div>
      )}
    </Form>
  );
}

/* ---------- Withdraw ---------- */

function Withdraw({ members, run, writing, flash }) {
  const [memberId, setMemberId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const current = members.find((m) => m.id === memberId);

  const submit = async (e) => {
    e.preventDefault();
    if (!memberId || Number(amount) <= 0) return flash("กรอกข้อมูลให้ครบ", "err");
    const ok = await run(() => api.addWithdrawal(memberId, Number(amount), note), "บันทึกการเบิกแล้ว");
    if (ok) { setAmount(""); setNote(""); }
  };

  return (
    <Form title="เบิกเงินกองกลาง" onSubmit={submit} writing={writing} submitText="บันทึกการเบิก">
      <Select label="ผู้เบิก" value={memberId} onChange={setMemberId} options={members.map((m) => [m.id, m.name])} />
      {current && <div className="preview">เบิกได้สูงสุด {money(current.balance)}</div>}
      <Input label="จำนวนเงิน" type="number" inputMode="decimal" value={amount} onChange={setAmount} />
      <Input label="หมายเหตุ" value={note} onChange={setNote} placeholder="เช่น ซื้อของส่วนตัว" />
    </Form>
  );
}

/* ---------- History ---------- */

const typeName = (type) => ({ DEPOSIT: "ฝากเงิน", EXPENSE: "ค่าใช้จ่าย", WITHDRAWAL: "เบิกเงิน" }[type] || type);

function History({ transactions }) {
  const [limit, setLimit] = useState(50);
  return (
    <section className="panel">
      <h2>ประวัติรายการ</h2>
      <div className="history">
        {transactions.slice(0, limit).map((t) => (
          <div className="history-row" key={t.id}>
            <div>
              <b>{typeName(t.type)}</b>
              <div>{t.note || "-"}</div>
              <small>{dateText(t.date)} · {t.memberName || "หลายคน"}</small>
            </div>
            <strong className={t.type === "DEPOSIT" ? "plus" : "minus"}>
              {t.type === "DEPOSIT" ? "+" : "-"}{money(t.amount)}
            </strong>
          </div>
        ))}
        {!transactions.length && <div className="empty">ยังไม่มีรายการ</div>}
      </div>
      {transactions.length > limit && (
        <button className="more" onClick={() => setLimit((l) => l + 50)}>แสดงเพิ่ม</button>
      )}
    </section>
  );
}

/* ---------- UI helpers ---------- */

function Form({ title, children, onSubmit, writing, submitText }) {
  return (
    <section className="panel form-panel">
      <h2>{title}</h2>
      <form onSubmit={onSubmit}>
        {children}
        <button disabled={writing}>{writing ? "กำลังบันทึก..." : submitText}</button>
      </form>
    </section>
  );
}

function Input({ label, value, onChange, ...props }) {
  return (
    <label>
      {label}
      <input {...props} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Select({ label, value, onChange, options, noEmpty }) {
  return (
    <label>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {!noEmpty && <option value="">-- เลือก --</option>}
        {options.map(([v, text]) => (
          <option key={v} value={v}>{text}</option>
        ))}
      </select>
    </label>
  );
}
