// 運用者が管理画面の「設定」で変える値（D1 の settings）。行が無ければ施設の設定の初めの値
//   bufferMinutes 前後の空ける時間（分）／leadDays 受付の締め切り（開始の何日前まで）／horizonDays 受付の先（何日先まで）
//   calendars 空きを見るカレンダーの ID の一覧／eventCalendar 予定を入れるカレンダー（既定 primary）／bank 振込先の口座（運用者が入れる文。Claude は書かない）

const NUM = ["bufferMinutes", "leadDays", "horizonDays"];
const LIMIT = { bufferMinutes: [0, 240], leadDays: [0, 30], horizonDays: [1, 365] };
const LABEL = { bufferMinutes: "前後に空ける時間（分）", leadDays: "受付の締め切り（何日前まで）", horizonDays: "受付の先（何日先まで）" };
// 管理画面がその欄の下に文を出せるよう、項目ごとの文（errors）を付ける（booking.js の InputError と同じ形。booking.js がここを読むので、写さず同じ形を作る）
const fieldError = (k, msg) => Object.assign(new Error(msg), { errors: { [k]: msg } });

export async function loadSettings(site, db) {
  const { results } = await db.prepare("SELECT setting_key, value FROM settings").all();
  const row = Object.fromEntries(results.map((r) => [r.setting_key, r.value]));
  const out = { ...site.defaults, calendars: [], eventCalendar: "primary", bank: "" };
  for (const k of NUM) if (row[k] !== undefined) out[k] = Number(row[k]);
  if (row.calendars) try { out.calendars = JSON.parse(row.calendars); } catch {}
  if (row.eventCalendar) out.eventCalendar = row.eventCalendar;
  if (row.bank !== undefined) out.bank = row.bank;
  return out;
}

/** 設定を変える。変えた項目の前と後を返す（変わらなければ空） */
export async function saveSettings(site, db, user, input, at) {
  const cur = await loadSettings(site, db);
  const next = {};
  for (const k of NUM) {
    if (input[k] === undefined) continue;
    const n = input[k] === null || String(input[k]).trim() === "" ? NaN : Number(input[k]); // 空欄・空白だけを 0 にしない
    if (!Number.isInteger(n) || n < LIMIT[k][0] || n > LIMIT[k][1]) throw fieldError(k, `${LABEL[k]}は ${LIMIT[k][0]}〜${LIMIT[k][1]} の整数で入れてください`);
    if (n !== cur[k]) next[k] = String(n);
  }
  if (input.calendars !== undefined) {
    if (!Array.isArray(input.calendars) || input.calendars.some((c) => typeof c !== "string" || !c || c.length > 200) || input.calendars.length > 10) throw new Error("見るカレンダーの選び方が正しくありません");
    const v = JSON.stringify(input.calendars);
    if (v !== JSON.stringify(cur.calendars)) next.calendars = v;
  }
  if (input.eventCalendar !== undefined) {
    const v = String(input.eventCalendar).trim();
    if (!v || v.length > 200) throw fieldError("eventCalendar", "予定を入れるカレンダーが正しくありません");
    if (v !== cur.eventCalendar) next.eventCalendar = v;
  }
  if (input.bank !== undefined) {
    const v = String(input.bank).replace(/\r\n/g, "\n").trim();
    if (v.length > 500) throw fieldError("bank", "振込先は500文字までにしてください");
    if (v !== cur.bank) next.bank = v;
  }
  const keys = Object.keys(next);
  if (!keys.length) return {};
  const who = user.google_sub;
  await db.batch(
    keys.map((k) =>
      db.prepare("INSERT INTO settings (setting_key, value, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (setting_key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by")
        .bind(k, next[k], at, who, at, who)
    )
  );
  // 振込先の口座は、変えたことだけを返す（値は記録の中で持ち回らない）
  return Object.fromEntries(keys.map((k) => [k, k === "bank" ? "（変えた）" : next[k]]));
}
