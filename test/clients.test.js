// コンサルの相手（F18）・月額の契約（F19）・相手ごとの集計（F20）。名前の [要件6-◯] は要件定義書の6節の番号
import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { admin, catchMail, fakeCalendar, login, makeWorker, reset, seedCatalog } from "./helpers.js";

let cal, worker, cookie, cat;
beforeEach(async () => {
  await reset();
  cal = fakeCalendar();
  worker = makeWorker(cal);
  catchMail();
  cookie = await login();
  cat = await seedCatalog(worker, cookie);
  await admin(worker, cookie, "settings", { calendars: ["primary"], bank: "試験銀行 本店 普通 0000000 シケン（見本）" });
});
afterEach(() => vi.restoreAllMocks());

const newClient = async (name = "見本 相手A", over = {}) => (await admin(worker, cookie, "client", { name, memo: "", ...over })).id;
const newContract = async (clientId, over = {}) =>
  admin(worker, cookie, "contract", { clientId, name: "月額の見本", monthlyAmount: 30000, startMonth: "2026-10", endMonth: "", memo: "", ...over });
const bookingRow = (id) => env.DB.prepare("SELECT * FROM bookings WHERE id = ?").bind(id).first();
let minute = 0;
const manual = (clientId, over = {}) =>
  admin(worker, cookie, "manual", { kind: "session", startAt: `2026-10-${String(26 + Math.floor(minute / 24)).padStart(2, "0")}T${String(minute++ % 24).padStart(2, "0")}:00`, minutes: 30, name: "見本 お客様", courseId: cat.courseA, payState: "paid", clientId, ...over });

describe("[要件6-15] コンサルの相手", () => {
  it("相手を登録して一覧に出る。名前が空なら入れられない", async () => {
    const id = await newClient("見本 相手A", { memo: "紹介の方" });
    expect(id).toBeTruthy();
    const list = (await admin(worker, cookie, "clients")).clients;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, name: "見本 相手A", memo: "紹介の方", visible: 1, contracts: [] });
    const bad = await admin(worker, cookie, "client", { name: "  " });
    expect(bad.ok).toBe(false);
    expect(bad.errors.name).toMatch(/名前/);
  });
  it("名前・メモ・出す／出さないを直せる。作った人・直した人が残る", async () => {
    const id = await newClient();
    expect((await admin(worker, cookie, "client", { id, name: "見本 相手B", memo: "メモ", visible: false })).ok).toBe(true);
    const r = await env.DB.prepare("SELECT * FROM clients WHERE id = ?").bind(id).first();
    expect(r).toMatchObject({ name: "見本 相手B", memo: "メモ", visible: 0, created_by: "sub-op", updated_by: "sub-op" });
    expect((await admin(worker, cookie, "client", { id: "nai", name: "x" })).error).toMatch(/見つかりません/);
  });
});

describe("[要件6-15] 手で入れる予約に相手を選ぶ", () => {
  it("相手を選んで入れると、予約に相手が付き、詳細に相手の名前が出る。履歴にも残る", async () => {
    const cid = await newClient();
    const r = await manual(cid);
    expect(r.ok).toBe(true);
    expect((await bookingRow(r.id)).client_id).toBe(cid);
    const d = await admin(worker, cookie, "booking?id=" + r.id);
    expect(d.booking).toMatchObject({ client_id: cid, client_name: "見本 相手A" });
    expect(d.history[0]).toMatchObject({ kind: "create", after: { client_id: cid } });
  });
  it("相手を選ばなくても入れられる（相手は空）", async () => {
    const r = await manual(undefined);
    expect(r.ok).toBe(true);
    expect((await bookingRow(r.id)).client_id).toBeNull();
  });
  it("その場で新しい相手を作って付けられる", async () => {
    const r = await manual(undefined, { newClientName: "見本 相手C" });
    expect(r.ok).toBe(true);
    const b = await bookingRow(r.id);
    expect((await env.DB.prepare("SELECT name FROM clients WHERE id = ?").bind(b.client_id).first()).name).toBe("見本 相手C");
  });
  it("ない相手の番号は入れられない。打ち合わせにも付けられる", async () => {
    expect((await manual("nai")).errors.clientId).toMatch(/相手/);
    const cid = await newClient();
    const m = await admin(worker, cookie, "manual", { kind: "meeting", startAt: "2026-10-25T14:00", minutes: 60, name: "定例", clientId: cid });
    expect((await bookingRow(m.id)).client_id).toBe(cid);
  });
  it("あとから相手を付け替えられ、前と後が履歴に残る。外すこともできる", async () => {
    const a = await newClient("見本 相手A"), b = await newClient("見本 相手B");
    const r = await manual(a);
    expect((await admin(worker, cookie, "booking-client", { id: r.id, clientId: b })).ok).toBe(true);
    expect((await bookingRow(r.id)).client_id).toBe(b);
    const h = (await admin(worker, cookie, "booking?id=" + r.id)).history.at(-1);
    expect(h).toMatchObject({ kind: "client", before: { client_id: a }, after: { client_id: b } });
    await admin(worker, cookie, "booking-client", { id: r.id, clientId: null });
    expect((await bookingRow(r.id)).client_id).toBeNull();
    expect((await admin(worker, cookie, "booking-client", { id: r.id, clientId: "nai" })).error).toMatch(/相手/);
  });
});

describe("[要件6-15] 月額の契約と月ごとの入金", () => {
  it("契約を入れる：月額は 0〜9,999,999 円の整数、終わりの月は始まりの月より前にできない", async () => {
    const cid = await newClient();
    const ok = await newContract(cid);
    expect(ok.ok).toBe(true);
    expect((await newContract(cid, { monthlyAmount: "" })).errors.monthlyAmount).toBeTruthy();
    expect((await newContract(cid, { monthlyAmount: 1.5 })).errors.monthlyAmount).toBeTruthy();
    expect((await newContract(cid, { monthlyAmount: 10000000 })).errors.monthlyAmount).toBeTruthy();
    expect((await newContract(cid, { startMonth: "2026-13" })).errors.startMonth).toBeTruthy();
    expect((await newContract(cid, { endMonth: "2026-09" })).errors.endMonth).toBeTruthy();
    expect((await newContract(cid, { name: "" })).errors.name).toBeTruthy();
    expect((await newContract("nai")).errors.clientId).toBeTruthy();
    const list = (await admin(worker, cookie, "clients")).clients;
    expect(list[0].contracts).toHaveLength(1);
    expect(list[0].contracts[0]).toMatchObject({ id: ok.id, monthly_amount: 30000, start_month: "2026-10", end_month: null, payments: [] });
  });
  it("契約を直せる（終わりの月を入れる）", async () => {
    const cid = await newClient();
    const { id } = await newContract(cid);
    expect((await admin(worker, cookie, "contract", { id, clientId: cid, name: "月額の見本", monthlyAmount: 33000, startMonth: "2026-10", endMonth: "2027-03", memo: "値上げ" })).ok).toBe(true);
    expect(await env.DB.prepare("SELECT monthly_amount, end_month, memo, updated_by FROM contracts WHERE id = ?").bind(id).first()).toMatchObject({ monthly_amount: 33000, end_month: "2027-03", memo: "値上げ", updated_by: "sub-op" });
  });
  it("月の「入金済み」を付ける：金額は月額が初めの値、入金の日は指定できる。外すと未入金に戻る", async () => {
    const cid = await newClient();
    const { id } = await newContract(cid);
    const r = await admin(worker, cookie, "contract-pay", { contractId: id, month: "2026-10", paidOn: "2026-10-28" });
    expect(r.ok).toBe(true);
    expect(await env.DB.prepare("SELECT amount, paid_on, created_by FROM contract_payments WHERE contract_id = ? AND month = '2026-10'").bind(id).first()).toMatchObject({ amount: 30000, paid_on: "2026-10-28", created_by: "sub-op" });
    // 同じ月をもう一度：1行のまま直る（金額も直せる）
    await admin(worker, cookie, "contract-pay", { contractId: id, month: "2026-10", amount: 25000, paidOn: "2026-10-29" });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM contract_payments WHERE contract_id = ?").bind(id).first()).n).toBe(1);
    expect((await admin(worker, cookie, "clients")).clients[0].contracts[0].payments[0]).toMatchObject({ month: "2026-10", amount: 25000, paid_on: "2026-10-29" });
    expect((await admin(worker, cookie, "contract-unpay", { contractId: id, month: "2026-10" })).ok).toBe(true);
    expect((await env.DB.prepare("SELECT paid_on FROM contract_payments WHERE contract_id = ?").bind(id).first()).paid_on).toBeNull();
  });
  it("入金の日を省くと今日（日本時間）。契約の期間の外の月・形の違う入力は付けられない", async () => {
    const cid = await newClient();
    const { id } = await newContract(cid, { startMonth: "2026-10", endMonth: "2026-12" });
    await admin(worker, cookie, "contract-pay", { contractId: id, month: "2026-11" });
    expect((await env.DB.prepare("SELECT paid_on FROM contract_payments WHERE contract_id = ?").bind(id).first()).paid_on).toBe("2026-10-19");
    expect((await admin(worker, cookie, "contract-pay", { contractId: id, month: "2026-09" })).error).toMatch(/期間/);
    expect((await admin(worker, cookie, "contract-pay", { contractId: id, month: "2027-01" })).error).toMatch(/期間/);
    expect((await admin(worker, cookie, "contract-pay", { contractId: id, month: "2026-10", paidOn: "10/28" })).error).toMatch(/入金の日/);
    expect((await admin(worker, cookie, "contract-pay", { contractId: id, month: "2026-10", amount: -1 })).error).toMatch(/金額/);
    expect((await admin(worker, cookie, "contract-pay", { contractId: "nai", month: "2026-10" })).error).toMatch(/契約/);
  });
});

describe("[要件6-16] 相手ごとの集計と月ごとの売上", () => {
  it("相手ごと：回数（確定の予約・打ち合わせ。キャンセルと試しは数えない）・予約の売上・月額の入金・合計", async () => {
    const a = await newClient("見本 相手A"), b = await newClient("見本 相手B"), none = await newClient("見本 相手D");
    await manual(a);
    await manual(a);
    await admin(worker, cookie, "manual", { kind: "meeting", startAt: "2026-10-25T14:00", minutes: 60, name: "定例", clientId: a });
    const gone = await manual(a);
    await admin(worker, cookie, "cancel", { id: gone.id });
    await manual(a, { name: "試験 予約" });
    await manual(a, { payState: "unpaid" }); // 仮押さえは確定ではない
    await manual(b, { startAt: "2026-11-02T10:00" }); // 別の月
    await manual(undefined); // 相手なし
    const { id } = await newContract(a);
    await admin(worker, cookie, "contract-pay", { contractId: id, month: "2026-10", paidOn: "2026-10-30" });
    await admin(worker, cookie, "contract-pay", { contractId: id, month: "2026-11", paidOn: "2026-11-01" }); // 入金の日の月で数える
    const r = await admin(worker, cookie, "client-stats?month=2026-10");
    expect(r.rows).toEqual([{ clientId: a, name: "見本 相手A", count: 3, bookingAmount: 13200, contractAmount: 30000, total: 43200 }]);
    const nov = await admin(worker, cookie, "client-stats?month=2026-11");
    expect(nov.rows.map((x) => [x.name, x.count, x.bookingAmount, x.contractAmount, x.total])).toEqual([["見本 相手A", 0, 0, 30000, 30000], ["見本 相手B", 1, 6600, 0, 6600]]);
    expect(nov.rows.find((x) => x.clientId === none)).toBeUndefined();
    expect((await admin(worker, cookie, "client-stats?month=2026-1")).ok).toBe(false);
  });
  it("入金の日が空（外した）の月は、月額の入金に数えない", async () => {
    const a = await newClient();
    const { id } = await newContract(a);
    await admin(worker, cookie, "contract-pay", { contractId: id, month: "2026-10", paidOn: "2026-10-30" });
    await admin(worker, cookie, "contract-unpay", { contractId: id, month: "2026-10" });
    expect((await admin(worker, cookie, "client-stats?month=2026-10")).rows).toEqual([]);
  });
  it("月ごとの売上に「月額の契約」を分けて足す（入金の日の月）。合計に入る", async () => {
    const a = await newClient();
    await manual(a);
    const { id } = await newContract(a);
    await admin(worker, cookie, "contract-pay", { contractId: id, month: "2026-10", paidOn: "2026-10-30" });
    await admin(worker, cookie, "contract-pay", { contractId: id, month: "2026-11", paidOn: "2026-11-02" });
    expect(await admin(worker, cookie, "stats?month=2026-10")).toMatchObject({ count: 1, amount: 6600, contractCount: 1, contractAmount: 30000, total: 36600 });
    expect(await admin(worker, cookie, "stats?month=2026-11")).toMatchObject({ count: 0, amount: 0, contractCount: 1, contractAmount: 30000, total: 30000 });
    expect(await admin(worker, cookie, "stats?month=2026-12")).toMatchObject({ contractCount: 0, contractAmount: 0, total: 0 });
  });
});
