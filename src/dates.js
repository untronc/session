// 日付は日本時間の暦で数える。日付は 'YYYY-MM-DD' の文字で持ち、計算は UTC の 0 時の Date で行う

const DAY = 86400000;

export function parseYmd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? ""));
  if (!m) throw new Error("日付の形が正しくありません");
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCMonth() !== +m[2] - 1) throw new Error("日付の形が正しくありません");
  return d;
}
export const ymd = (d) => d.toISOString().slice(0, 10);
export const addDays = (d, n) => new Date(d.getTime() + n * DAY);
export const nightsBetween = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / DAY);
/** 日本時間の今日（UTC の 0 時の Date） */
export const todayJst = (now = new Date()) => parseYmd(new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10));
export const monthOf = (d) => ymd(d).slice(0, 7);
/** 2026-11-04 → 2026年11月4日（水）。withYear が false なら年を付けない（リリース1の jpDate_ と同じ） */
export function jpDate(d, withYear = true) {
  const [y, m, dd] = ymd(d).split("-").map(Number);
  return (withYear ? y + "年" : "") + m + "月" + dd + "日（" + "日月火水木金土"[d.getUTCDay()] + "）";
}
/** [from, to) の日付の文字の配列 */
export function daysIn(from, to) {
  const out = [];
  for (let d = from; d < to; d = addDays(d, 1)) out.push(ymd(d));
  return out;
}
/** 日本時間の 'YYYY-MM-DD HH:mm'（リリース1の受付の書き方） */
export function jstStamp(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 16).replace("T", " ");
}
