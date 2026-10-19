// 施設の設定を確かめる。値の中身（運用者のメール・送り元・プライバシーポリシー・見本の案内）は施設の設定ファイル（sites/<名前>/site.config.js・公開しない）に書く
// 足りない項目があれば、起動の前に止める（決まっていない値を仮で埋めないため）
// 振込先の口座・前後の空ける時間・受付の締め切りと先・見るカレンダーは、運用者が管理画面の「設定」で変える（D1 の settings）。ここには初めの値だけ

const REQUIRED = [
  "name", "adminUrl", "allowedOrigins", "admins",
  "mail", "privacyUrl", "privacyVersion", "showcase",
  "defaults", "maxLen", "dailyLimit", "perContactDailyLimit", "accessLogDays", "slotDaysAhead",
];

export function defineSite(site) {
  const missing = REQUIRED.filter((k) => site[k] === undefined || site[k] === null);
  if (missing.length) throw new Error(`施設の設定に足りない項目があります：${missing.join(", ")}`);
  for (const k of ["from", "notifyTo", "replyTo"]) if (site.mail[k] === undefined) throw new Error(`mail.${k} がありません`);
  for (const k of ["bufferMinutes", "leadDays", "horizonDays"]) if (!Number.isInteger(site.defaults[k])) throw new Error(`defaults.${k} がありません`);
  for (const k of ["text", "url"]) if (!site.showcase[k]) throw new Error(`showcase.${k} がありません`);
  return Object.freeze({ ...site, admins: site.admins.map((a) => a.toLowerCase()) });
}
