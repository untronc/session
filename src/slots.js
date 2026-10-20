// くり返しの枠（slot_rules）から、今日から site.slotDaysAhead 日先までの枠を作る（基本設計書 F2）
// 同じ決まり・同じ開始の枠がもうあれば作らない（閉じた枠も作り直さない：運用者が1つずつ閉じたものを開け直さないため）
// 手で開けた枠など、ほかの枠が同じ開始にあるときも作らない（同じ時刻の枠が2つ並ばないように）
import { addDays, todayJst, ymd } from "./dates.js";

export async function generateSlots(site, db, now = new Date()) {
  const { results: rules } = await db.prepare("SELECT * FROM slot_rules WHERE active = 1").all();
  if (!rules.length) return 0;
  const at = now.toISOString(), today = todayJst(now);
  const stmts = [];
  for (let i = 0; i <= site.slotDaysAhead; i++) {
    const d = addDays(today, i), day = ymd(d);
    for (const r of rules) {
      if (d.getUTCDay() !== r.weekday || day < r.from_date || (r.to_date && day > r.to_date)) continue;
      const start = day + "T" + r.start_time;
      stmts.push(
        db.prepare("INSERT INTO slots (id, start_at, minutes, state, rule_id, created_at, created_by, updated_at, updated_by) SELECT ?, ?, ?, 'open', ?, ?, 'system', ?, 'system' WHERE NOT EXISTS (SELECT 1 FROM slots WHERE start_at = ?) ON CONFLICT (rule_id, start_at) DO NOTHING")
          .bind(crypto.randomUUID(), start, r.minutes, r.id, at, at, start)
      );
    }
  }
  let made = 0;
  for (let i = 0; i < stmts.length; i += 50) for (const res of await db.batch(stmts.slice(i, i + 50))) made += res.meta.changes;
  return made;
}
