// くり返しの枠（slot_rules）から、今日から site.slotDaysAhead 日先までの枠を作る（基本設計書 F2）
// 同じ決まり・同じ開始の枠がもうあれば作らない（閉じた枠も作り直さない：運用者が1つずつ閉じたものを開け直さないため）
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
      stmts.push(
        db.prepare("INSERT INTO slots (id, start_at, minutes, state, rule_id, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, 'open', ?, ?, 'system', ?, 'system') ON CONFLICT (rule_id, start_at) DO NOTHING")
          .bind(crypto.randomUUID(), day + "T" + r.start_time, r.minutes, r.id, at, at)
      );
    }
  }
  let made = 0;
  for (let i = 0; i < stmts.length; i += 50) for (const res of await db.batch(stmts.slice(i, i + 50))) made += res.meta.changes;
  return made;
}
