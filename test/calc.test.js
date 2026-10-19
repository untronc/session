// 決まりの計算（基本設計書 3-3）。要件の番号は、要件定義書の6節の受け入れ条件の番号
import { describe, expect, it } from "vitest";
import { addMinutes, availableSlots, bookableRange, cancelRate, dueDate, overlaps, refundAmount, toRfc3339 } from "../src/calc.js";

// 2026-10-19（月）12:00 日本時間
const NOW = new Date("2026-10-19T03:00:00Z");

describe("日時の形", () => {
  it("日本時間の 'YYYY-MM-DDTHH:MM' に分を足す（日をまたぐ）", () => {
    expect(addMinutes("2026-10-25T13:30", 90)).toBe("2026-10-25T15:00");
    expect(addMinutes("2026-10-25T23:30", 60)).toBe("2026-10-26T00:30");
    expect(addMinutes("2026-10-25T00:10", -30)).toBe("2026-10-24T23:40");
  });
  it("Google カレンダーに渡す形（+09:00）", () => {
    expect(toRfc3339("2026-10-25T13:30")).toBe("2026-10-25T13:30:00+09:00");
  });
});

describe("[要件6-2] 重なりの判定（前後の空ける時間を足す）", () => {
  const a = { start: "2026-10-25T13:30", end: "2026-10-25T15:00" };
  it("前後30分の中にかかれば重なる・ちょうど30分空いていれば重ならない", () => {
    expect(overlaps(a, { start: "2026-10-25T15:20", end: "2026-10-25T16:00" }, 30)).toBe(true);
    expect(overlaps(a, { start: "2026-10-25T15:30", end: "2026-10-25T16:00" }, 30)).toBe(false);
    expect(overlaps(a, { start: "2026-10-25T12:00", end: "2026-10-25T13:00" }, 30)).toBe(false);
    expect(overlaps(a, { start: "2026-10-25T12:00", end: "2026-10-25T13:01" }, 30)).toBe(true);
  });
  it("空ける時間が0なら、端が接しても重ならない", () => {
    expect(overlaps(a, { start: "2026-10-25T15:00", end: "2026-10-25T16:00" }, 0)).toBe(false);
  });
});

describe("[5節 枠] 受付の範囲（2日前まで・60日先まで）", () => {
  it("今日が 10/19 なら、10/21 から 12/18 まで", () => {
    expect(bookableRange(NOW, { leadDays: 2, horizonDays: 60 })).toEqual({ from: "2026-10-21", to: "2026-12-18" });
  });
  it("日本時間の日付で数える（UTC では前の日の 23 時でも、日本時間の 10/20 なら 10/22 から）", () => {
    expect(bookableRange(new Date("2026-10-19T15:30:00Z"), { leadDays: 2, horizonDays: 60 }).from).toBe("2026-10-22");
  });
});

describe("[要件6-2・6-3] 予約画面に出す枠", () => {
  const settings = { bufferMinutes: 30, leadDays: 2, horizonDays: 60 };
  const slot = (id, start_at, minutes = 90, state = "open") => ({ id, start_at, minutes, state });
  const slots = [
    slot("s1", "2026-10-20T10:00"), // 受付の範囲の前（2日前を過ぎた）
    slot("s2", "2026-10-21T10:00"),
    slot("s3", "2026-10-21T13:00"),
    slot("s4", "2026-10-22T10:00"), // カレンダーの予定とぶつかる
    slot("s5", "2026-10-22T19:00", 90, "closed"), // 閉じた
    slot("s6", "2026-10-23T10:00"), // 予約が入っている
    slot("s7", "2026-12-19T10:00"), // 60日先より後
    slot("s8", "2026-10-24T12:00"), // 前の予約（キャンセル済み）は数えない
    slot("s9", "2026-10-24T09:00"), // 手で入れた枠の外の予約（10:30〜11:30）の前30分にかかる
  ];
  const bookings = [
    { start_at: "2026-10-23T10:00", end_at: "2026-10-23T11:30", status: "hold" },
    { start_at: "2026-10-24T12:00", end_at: "2026-10-24T13:30", status: "cancelled" },
    { start_at: "2026-10-24T10:30", end_at: "2026-10-24T11:30", status: "confirmed" },
  ];
  const busy = [{ start: "2026-10-22T11:00", end: "2026-10-22T12:00" }];
  it("開いていて・範囲の中で・予約とカレンダーの予定に（前後30分を足して）重ならない枠だけ。開始の順", () => {
    expect(availableSlots({ slots, bookings, busy, settings, now: NOW }).map((s) => s.id)).toEqual(["s2", "s3", "s8"]);
  });
  it("返す枠には終わりの時刻を付ける", () => {
    expect(availableSlots({ slots: [slot("s2", "2026-10-21T10:00")], bookings: [], busy: [], settings, now: NOW })[0]).toMatchObject({ id: "s2", start_at: "2026-10-21T10:00", end_at: "2026-10-21T11:30" });
  });
});

describe("[要件6-4] 振込の期限（予約から1週間以内、かつセッションの前日まで）", () => {
  it("セッションが遠ければ、予約の日から7日目", () => {
    expect(dueDate(NOW, "2026-11-10T10:00")).toBe("2026-10-26");
  });
  it("セッションが近ければ、前日", () => {
    expect(dueDate(NOW, "2026-10-25T13:30")).toBe("2026-10-24");
  });
  it("ちょうど同じ日になる境目（8日後のセッション）", () => {
    expect(dueDate(NOW, "2026-10-27T10:00")).toBe("2026-10-26");
  });
  it("日本時間の日付で数える", () => {
    expect(dueDate(new Date("2026-10-19T15:30:00Z"), "2026-12-01T10:00")).toBe("2026-10-27");
  });
});

describe("[要件6-7] キャンセル料の率（セッションの日を0日目）", () => {
  const start = "2026-10-25T13:30";
  it.each([
    ["2026-10-19T03:00:00Z", 0],
    ["2026-10-22T14:59:00Z", 0], // 10/22 23:59 日本時間＝3日前
    ["2026-10-22T15:00:00Z", 50], // 10/23 0:00 日本時間＝2日前
    ["2026-10-24T14:59:00Z", 50], // 前日
    ["2026-10-24T15:00:00Z", 100], // 当日
    ["2026-10-26T01:00:00Z", 100], // 過ぎてから（連絡なし）
  ])("%s のキャンセルは %i%", (at, rate) => {
    expect(cancelRate(new Date(at), start, false)).toBe(rate);
  });
  it("運用者の都合なら、いつでも0%", () => {
    expect(cancelRate(new Date("2026-10-25T03:00:00Z"), start, true)).toBe(0);
  });
});

describe("[要件6-7] 返金の額", () => {
  it("入金のあと：入金の額 − キャンセル料 − 振込手数料", () => {
    expect(refundAmount({ amount: 6600, paid: true, rate: 0, transferFee: 145 })).toEqual({ fee: 0, refund: 6455 });
    expect(refundAmount({ amount: 6600, paid: true, rate: 50, transferFee: 145 })).toEqual({ fee: 3300, refund: 3155 });
    expect(refundAmount({ amount: 6600, paid: true, rate: 100, transferFee: 145 })).toEqual({ fee: 6600, refund: 0 });
  });
  it("入金の前のキャンセルは、返金なし", () => {
    expect(refundAmount({ amount: 6600, paid: false, rate: 50, transferFee: 145 })).toEqual({ fee: 0, refund: 0 });
  });
  it("運用者の都合なら、振込手数料も差し引かず全額", () => {
    expect(refundAmount({ amount: 6600, paid: true, rate: 0, transferFee: 145, operatorFault: true })).toEqual({ fee: 0, refund: 6600 });
  });
  it("キャンセル料の端数は切り捨て（お客様に有利な方）", () => {
    expect(refundAmount({ amount: 6601, paid: true, rate: 50, transferFee: 0 })).toEqual({ fee: 3300, refund: 3301 });
  });
});
