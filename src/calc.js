// 決まりの計算（基本設計書 3-3）。D1 や Google には触らない
// 日時は日本時間の 'YYYY-MM-DDTHH:MM'（文字の順＝時刻の順）。日付は 'YYYY-MM-DD'
import { addDays, parseYmd, todayJst, ymd } from "./dates.js";

const MIN = 60000;
const JST = 9 * 3600000;

/** 'YYYY-MM-DDTHH:MM'（日本時間）→ その瞬間の Date */
export function parseLocal(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(s ?? ""));
  if (!m) throw new Error("日時の形が正しくありません");
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - JST);
  if (formatLocal(d) !== s) throw new Error("日時の形が正しくありません");
  return d;
}
/** Date → 'YYYY-MM-DDTHH:MM'（日本時間） */
export const formatLocal = (d) => new Date(d.getTime() + JST).toISOString().slice(0, 16);
export const addMinutes = (s, n) => formatLocal(new Date(parseLocal(s).getTime() + n * MIN));
/** Google カレンダーに渡す形 */
export const toRfc3339 = (s) => (parseLocal(s), s + ":00+09:00");
/** 日時の日付の部分 */
export const dateOf = (s) => String(s).slice(0, 10);

/** 2つの時間が重なるか。b の前後に buffer 分を足して見る（端が接するだけなら重ならない） */
export function overlaps(a, b, buffer = 0) {
  const bs = addMinutes(b.start, -buffer), be = addMinutes(b.end, buffer);
  return a.start < be && bs < a.end;
}

/** 予約を受ける日の範囲（日本時間の今日から leadDays 日後〜horizonDays 日後） */
export function bookableRange(now, { leadDays, horizonDays }) {
  const t = todayJst(now);
  return { from: ymd(addDays(t, leadDays)), to: ymd(addDays(t, horizonDays)) };
}

/**
 * 予約画面に出す枠：開いていて、受付の範囲の中で、予約（仮押さえ・確定）とカレンダーの予定に、前後の空ける時間を足しても重ならないもの
 * busy はカレンダーの「予定がある時間」[{start, end}]（日本時間の形）
 */
export function availableSlots({ slots, bookings, busy, settings, now }) {
  const range = bookableRange(now, settings);
  const taken = bookings.filter((b) => b.status !== "cancelled").map((b) => ({ start: b.start_at, end: b.end_at }));
  return slots
    .filter((s) => s.state === "open")
    .filter((s) => dateOf(s.start_at) >= range.from && dateOf(s.start_at) <= range.to)
    .map((s) => ({ ...s, end_at: addMinutes(s.start_at, s.minutes) }))
    .filter((s) => {
      const me = { start: s.start_at, end: s.end_at };
      return !taken.some((t) => overlaps(me, t, settings.bufferMinutes)) && !busy.some((b) => overlaps(me, b, settings.bufferMinutes));
    })
    .sort((a, b) => (a.start_at < b.start_at ? -1 : a.start_at > b.start_at ? 1 : 0));
}

/** 振込の期限：「予約した日＋7日」と「セッションの前日」の早い方（日本時間の日。この日の終わりまで） */
export function dueDate(now, startAt) {
  const week = addDays(todayJst(now), 7);
  const eve = addDays(parseYmd(dateOf(startAt)), -1);
  return ymd(week < eve ? week : eve);
}

/** キャンセル料の率：セッションの日を0日目として、3日前まで0%・2日前〜前日50%・当日（と過ぎてから）100%。運用者の都合なら0% */
export function cancelRate(now, startAt, operatorFault) {
  if (operatorFault) return 0;
  const days = Math.round((parseYmd(dateOf(startAt)) - todayJst(now)) / 86400000);
  if (days >= 3) return 0;
  if (days >= 1) return 50;
  return 100;
}

/** 返金の額：入金の額 − キャンセル料（切り捨て）− 振込手数料。入金の前は返金なし。運用者の都合なら手数料も差し引かず全額 */
export function refundAmount({ amount, paid, rate, transferFee = 0, operatorFault = false }) {
  if (!paid) return { fee: 0, refund: 0 };
  if (operatorFault) return { fee: 0, refund: amount };
  const fee = Math.floor((amount * rate) / 100);
  return { fee, refund: Math.max(0, amount - fee - (fee === amount ? 0 : transferFee)) };
}
