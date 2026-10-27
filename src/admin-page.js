// 管理画面の HTML（1枚。画面の切り替えはこの中の JS）。スマートフォンでの利用を優先する
// 宿泊の予約システム（untronc/yoyaku）の管理画面（src/admin-page.js）を写して始め、時刻の枠の予約に作り直した（基本設計書 2節 A1〜A9）
// 見た目は Bootstrap 5.3.3（Worker の静的ファイル /vendor/…）と src/theme.js。色は untronc の緑1つ
// 画面：予約の一覧（/admin）・予約の詳細（/admin/b/予約番号）・手で入れる（/admin/new）・枠（/admin/slots）・相手（/admin/clients）・売上（/admin/stats）・設定（/admin/settings）・名前（/admin/me）
import { BOOTSTRAP_CSS, BOOTSTRAP_JS, ICONS_CSS } from "./assets.js";
import { DEFAULT_THEME, adminCss } from "./theme.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function adminPage(site) {
  const nav = (href, icon, label, key) =>
    `<li class="nav-item"><a class="nav-link" href="${href}" data-go data-nav="${key}"><i class="bi bi-${icon}" aria-hidden="true"></i> <span>${label}</span></a></li>`;
  return `<!doctype html><html lang="ja" data-theme="${DEFAULT_THEME}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(site.name)} 予約管理</title><link rel="stylesheet" href="${BOOTSTRAP_CSS}"><link rel="stylesheet" href="${ICONS_CSS}"><style>${adminCss()}</style></head><body>
<nav class="navbar navbar-expand-md adm-nav"><div class="container-fluid adm-nav-in">
<a class="navbar-brand" href="/admin" data-go>${esc(site.name)} 予約管理</a>
<button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#admNav" aria-controls="admNav" aria-expanded="false" aria-label="メニューを開く"><span class="navbar-toggler-icon"></span></button>
<div class="collapse navbar-collapse" id="admNav"><ul class="navbar-nav me-auto">
${nav("/admin", "card-list", "予約", "list")}${nav("/admin/slots", "calendar-week", "枠", "slots")}${nav("/admin/clients", "people", "相手", "clients")}${nav("/admin/stats", "bar-chart-line", "売上", "stats")}${nav("/admin/settings", "gear", "設定", "settings")}
</ul><ul class="navbar-nav"><li class="nav-item"><a class="nav-link" href="/admin/me" data-go data-nav="me"><i class="bi bi-person-circle" aria-hidden="true"></i> <span id="me">…</span></a></li></ul></div></div></nav>
<main class="adm-main" id="main"><p class="text-secondary">読み込み中…</p></main>
<div class="modal fade" id="askModal" tabindex="-1" aria-labelledby="askTitle" aria-hidden="true"><div class="modal-dialog modal-dialog-centered"><div class="modal-content">
<div class="modal-header"><h5 class="modal-title" id="askTitle"></h5><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="閉じる"></button></div>
<div class="modal-body" id="askBody"></div>
<div class="modal-footer"><button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">やめる</button><button type="button" class="btn btn-primary" id="askOk"></button></div>
</div></div></div>
<script src="${BOOTSTRAP_JS}"></script>
<script>${SCRIPT}</script></body></html>`;
}

// 画面の JS。サーバーから来た値は必ず e() でエスケープしてから HTML に入れる
// 日時：予約・枠の start_at は日本時間の「YYYY-MM-DDTHH:MM」。受付・変更履歴の時刻は UTC の ISO（when() で日本時間に直す）
// キャンセル料の率（cancel_rate・rate）は 0／50／100 の整数（％の数そのもの。calc.js の cancelRate）
const SCRIPT = String.raw`
(function () {
  var M = document.getElementById('main'), INFO = null, FLASH = '', GEN = 0;
  var W = '日月火水木金土';
  function e(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function yen(n) { return Number(n || 0).toLocaleString('ja-JP') + '円'; }
  function pad(n) { return String(n).padStart(2, '0'); }
  function ymd(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function parse(s) { var p = s.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function addDays(s, n) { return ymd(new Date(parse(s).getTime() + n * 86400000)); }
  function today() { return ymd(new Date(Date.now() + 9 * 3600000)); }
  function jp(s) { var d = parse(s); return (d.getUTCMonth() + 1) + '月' + d.getUTCDate() + '日（' + W[d.getUTCDay()] + '）'; }
  function hm(local) { return String(local).slice(11, 16); }
  function span(b) { return jp(b.start_at.slice(0, 10)) + ' ' + hm(b.start_at) + '〜' + hm(b.end_at); }
  function when(iso) { var d = new Date(new Date(iso).getTime() + 9 * 3600000); return ymd(d) + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()); }
  function monthLabel(mo) { return mo.slice(0, 4) + '年' + (+mo.slice(5)) + '月'; }
  function shiftMonth(mo, n) { var y = +mo.slice(0, 4), m = +mo.slice(5, 7) - 1 + n; return ymd(new Date(Date.UTC(y, m, 1))).slice(0, 7); }
  function lastDay(mo) { return addDays(shiftMonth(mo, 1) + '-01', -1); }
  function bi(n) { return '<i class="bi bi-' + n + '" aria-hidden="true"></i>'; }
  // 読むだけの問い合わせ（GET）は、画面を移ったあとに返ってきたら捨てる（古い画面で新しい画面を上書きしないため。route() のたびに GEN が増える）
  function api(path, body) {
    var opt = body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {};
    var gen = GEN;
    return fetch('/admin/api/' + path, opt).then(function (r) {
      if (r.status === 401) { location.href = '/admin/login?next=' + encodeURIComponent(location.pathname); throw new Error('login'); }
      return r.json();
    }).then(function (j) {
      if (!body && gen !== GEN) return new Promise(function () {});
      // 「もう一度押せば進める」応答（needAck・needForce）は、呼んだ側で扱う
      if (!j.ok && !j.needAck && !j.needForce) { var x = new Error(j.error || 'エラー'); x.errors = j.errors; throw x; }
      return j;
    });
  }
  function err(x) { return '<div class="alert alert-danger py-2" role="alert">' + bi('exclamation-triangle-fill') + ' ' + e(x && x.message || x) + '</div>'; }
  function warn(t) { return '<div class="alert alert-warning py-2" role="alert">' + bi('exclamation-triangle-fill') + ' ' + e(t) + '</div>'; }
  function okBox(t) { return '<div class="alert alert-success py-2" role="status">' + bi('check-lg') + ' ' + t + '</div>'; }
  function loading() { M.innerHTML = '<p class="text-secondary">読み込み中…</p>'; }
  function val(id) { return document.getElementById(id).value; }
  function checked(id) { return document.getElementById(id).checked; }

  // ----- Bootstrap の小さな部品 -----
  function overdue(b) { return b.status === 'hold' && b.pay_state === 'unpaid' && b.due_date && b.due_date < today(); }
  function stBadge(b) {
    if (b.status === 'cancelled') return '<span class="badge text-bg-secondary">' + bi('x-circle-fill') + ' キャンセル</span>';
    if (b.status === 'hold') return overdue(b) ? '<span class="badge text-bg-primary" data-overdue>' + bi('exclamation-circle-fill') + ' 振込の期限切れ</span>' : '<span class="badge text-bg-light border">' + bi('hourglass-split') + ' 仮押さえ（振込待ち）</span>';
    return '<span class="badge text-bg-success">' + bi('check-circle-fill') + ' 確定</span>';
  }
  function kindBadge(b) { return b.kind === 'meeting' ? '<span class="badge text-bg-light border">' + bi('people') + ' 打ち合わせ</span>' : ''; }
  function srcBadge(b) { return b.source === 'manual' ? '<span class="badge text-bg-light border">' + bi('pencil') + ' 手で入力</span>' : ''; }
  function payLabel(s) { return { unpaid: '未入金', paid: '入金済み', free: '0円' }[s] || ''; }
  function dash(v) { return v ? e(v) : '<span class="text-secondary">（なし）</span>'; }
  function liRow(k, v) { return '<li class="list-group-item d-flex flex-column flex-sm-row gap-1 gap-sm-3"><span class="bs-k">' + k + '</span><span class="bs-v">' + v + '</span></li>'; }
  function lg(rows) { return '<ul class="list-group list-group-flush">' + rows.join('') + '</ul>'; }
  function cardBs(icon, title, body, attrs) { return '<div class="card mb-3 shadow-sm"' + (attrs || '') + '><div class="card-header fw-bold">' + bi(icon) + ' ' + title + '</div>' + body + '</div>'; }
  function crumbs(list) {
    return '<nav aria-label="breadcrumb"><ol class="breadcrumb mb-2 small">' + list.map(function (x, i) {
      return i === list.length - 1 ? '<li class="breadcrumb-item active" aria-current="page">' + x[0] + '</li>' : '<li class="breadcrumb-item"><a href="' + x[1] + '" data-go>' + x[0] + '</a></li>';
    }).join('') + '</ol></nav>';
  }
  /** 入力欄1つ：ラベル（必須／任意）・欄・説明・まちがいの文（data-err） */
  function field(key, id, label, req, inner, hint) {
    return '<div class="mb-3"><label class="form-label" for="' + id + '">' + label + (req === null ? '' : req ? '<span class="req">必須</span>' : '<span class="opt">任意</span>') + '</label>' + inner + (hint ? '<div class="form-text">' + hint + '</div>' : '') + errBox(key) + '</div>';
  }
  function input(key, id, v, extra) { return '<input class="form-control" id="' + id + '" data-fk="' + key + '" value="' + e(v) + '" ' + (extra || '') + '>'; }
  function check(id, label, on, extra) { return '<div class="form-check mb-2"><input class="form-check-input" type="checkbox" id="' + id + '"' + (on ? ' checked' : '') + ' ' + (extra || '') + '><label class="form-check-label" for="' + id + '">' + label + '</label></div>'; }

  // ----- まちがいの文：サーバーが返した項目ごとの文を、その欄の下に出す（入力チェックはサーバーだけ） -----
  function errBox(k) { return '<div class="invalid-feedback" data-err="' + k + '"></div>'; }
  function showErrs(box, errors) {
    box.querySelectorAll('[data-err]').forEach(function (el) {
      var k = el.getAttribute('data-err');
      el.textContent = (errors && errors[k]) || '';
      el.style.display = errors && errors[k] ? 'block' : '';
      box.querySelectorAll('[data-fk="' + k + '"]').forEach(function (c) { c.classList.toggle('is-invalid', !!(errors && errors[k])); });
    });
  }
  // 注意が出ている欄を直し始めたら、その欄の注意を消す
  function clearOnEdit(ev) {
    var t = ev.target && ev.target.closest && ev.target.closest('[data-fk]');
    if (!t || !t.classList.contains('is-invalid')) return;
    var k = t.getAttribute('data-fk'), box = t.closest('li.list-group-item, .card-body, main') || document;
    t.classList.remove('is-invalid');
    box.querySelectorAll('[data-err="' + k + '"]').forEach(function (el) { el.textContent = ''; el.style.display = ''; });
  }
  document.addEventListener('input', clearOnEdit);
  document.addEventListener('change', clearOnEdit);
  /** 失敗したとき：項目ごとの文があれば欄の下に、無ければ枠（out）に出す */
  function fail(box, out, x) {
    showErrs(box, {});
    // 項目ごとの文が、この枠のどの欄にも当たらなければ、枠（out）に出す
    var hit = x && x.errors && Object.keys(x.errors).some(function (k) { return box.querySelector('[data-err="' + k + '"]'); });
    if (hit) { showErrs(box, x.errors); return; }
    out.innerHTML = err(x);
  }
  /** 窓（取り消し・外す）のあとの失敗：画面の先頭の置き場1つに上書きする */
  function topErr(x) {
    var t = document.getElementById('topErr');
    if (!t) { M.insertAdjacentHTML('afterbegin', '<div id="topErr"></div>'); t = document.getElementById('topErr'); }
    t.innerHTML = err(x);
    window.scrollTo(0, 0);
  }
  /** 押したら、終わるまでボタンを止める */
  function busy(btn, p) { btn.disabled = true; return p.then(function (v) { btn.disabled = false; return v; }, function (x) { btn.disabled = false; throw x; }); }

  // ----- 確かめの窓（取り消せない操作の前） -----
  var askFn = null;
  function ask(title, body, okLabel, danger, fn) {
    document.getElementById('askTitle').innerHTML = title;
    document.getElementById('askBody').innerHTML = body;
    var ok = document.getElementById('askOk');
    ok.textContent = okLabel;
    ok.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
    askFn = fn;
    bootstrap.Modal.getOrCreateInstance(document.getElementById('askModal')).show();
  }
  document.getElementById('askOk').onclick = function () {
    var fn = askFn; askFn = null;
    bootstrap.Modal.getOrCreateInstance(document.getElementById('askModal')).hide();
    if (fn) fn();
  };

  // ----- 画面の切り替え -----
  function go(path) { history.pushState(null, '', path); route(); }
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest('a[data-go]');
    if (a) {
      ev.preventDefault();
      var c = document.getElementById('admNav');
      if (c && c.classList.contains('show') && window.bootstrap) bootstrap.Collapse.getOrCreateInstance(c).hide();
      go(a.getAttribute('href'));
    }
  });
  window.addEventListener('popstate', route);
  function setNav(key) {
    document.querySelectorAll('.adm-nav [data-nav]').forEach(function (a) {
      var on = a.getAttribute('data-nav') === key;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }
  function route() {
    var p = location.pathname, m;
    GEN++;
    window.scrollTo(0, 0);
    if ((m = /^\/admin\/b\/([\w-]+)$/.exec(p))) { setNav('list'); return booking(decodeURIComponent(m[1])); }
    if (p === '/admin/new') { setNav('list'); return addForm(new URLSearchParams(location.search).get('d')); }
    if (p === '/admin/slots') { setNav('slots'); return slots(); }
    if (p === '/admin/clients') { setNav('clients'); return clients(); }
    if (p === '/admin/stats') { setNav('stats'); return stats(); }
    if (p === '/admin/settings') { setNav('settings'); return settings(); }
    if (p === '/admin/me') { setNav('me'); return me(); }
    setNav('list');
    return list(new URLSearchParams(location.search).get('m') || today().slice(0, 7));
  }

  // ----- 予約の一覧（A3・A4：振込待ちを上に。期限を過ぎた予約は目立たせる） -----
  function row(b) {
    var who = b.kind === 'meeting' ? e(b.name) : e(b.name) + ' 様';
    var what = b.kind === 'meeting' ? '' : (b.course_name ? e(b.course_name) + '・' : '') + yen(b.amount) + '・' + payLabel(b.pay_state);
    return '<a class="list-group-item list-group-item-action py-3' + (b.status === 'cancelled' ? ' text-secondary' : '') + '" href="/admin/b/' + encodeURIComponent(b.id) + '" data-go data-booking="' + e(b.id) + '"><div class="d-flex justify-content-between align-items-start gap-2"><div class="d-flex flex-wrap align-items-center gap-2"><b>' + hm(b.start_at) + '〜' + hm(b.end_at) + '</b><b>' + who + '</b>' + stBadge(b) + kindBadge(b) + srcBadge(b) + '</div>' + bi('chevron-right') + '</div>' +
      (what ? '<div class="small text-secondary mt-1">' + what + (b.status === 'hold' && b.due_date ? '・振込の期限 ' + jp(b.due_date) : '') + '</div>' : '') + '</a>';
  }
  function list(mo) {
    loading();
    var t = today();
    Promise.all([api('bookings?from=' + mo + '-01&to=' + lastDay(mo)), api('bookings?from=' + addDays(t, -60) + '&to=' + addDays(t, 365))]).then(function (r) {
      var all = r[0].bookings, waiting = r[1].bookings.filter(function (b) { return b.status === 'hold' && b.pay_state === 'unpaid'; });
      waiting.sort(function (a, b) { return (a.due_date || '') < (b.due_date || '') ? -1 : 1; });
      var h = '';
      if (waiting.length) {
        var late = waiting.filter(overdue).length;
        h += cardBs('hourglass-split', '振込待ち ' + waiting.length + '件' + (late ? '<span class="badge text-bg-primary ms-2">期限切れ ' + late + '件</span>' : ''),
          '<div class="list-group list-group-flush">' + waiting.map(function (b) { return row(b).replace('<b>' + hm(b.start_at), '<b>' + jp(b.start_at.slice(0, 10)) + ' ' + hm(b.start_at)); }).join('') + '</div>' +
          '<div class="card-body py-2 small text-secondary">通帳と照らして、入金があった予約を開き「入金済みにする」を押します。期限を過ぎても自動では外れません。</div>', ' data-card="waiting"');
      }
      h += '<div class="d-flex justify-content-between align-items-center gap-2 mb-2"><a class="btn btn-outline-secondary btn-sm" href="/admin?m=' + shiftMonth(mo, -1) + '" data-go>' + bi('chevron-left') + ' 前の月</a><h1 class="mb-0">' + monthLabel(mo) + '</h1><a class="btn btn-outline-secondary btn-sm" href="/admin?m=' + shiftMonth(mo, 1) + '" data-go>次の月 ' + bi('chevron-right') + '</a></div>';
      var days = {};
      all.forEach(function (b) { var d = b.start_at.slice(0, 10); (days[d] = days[d] || []).push(b); });
      var keys = Object.keys(days).sort();
      h += keys.length ? keys.map(function (d) {
        return '<h2' + (d === t ? ' class="text-primary"' : '') + '>' + jp(d) + (d === t ? '（今日）' : '') + '</h2><div class="list-group shadow-sm mb-2">' + days[d].map(row).join('') + '</div>';
      }).join('') : '<div class="alert alert-light border">この月の予約はありません。</div>';
      h += '<p class="mt-3"><a class="btn btn-primary" href="/admin/new" data-go>' + bi('plus-lg') + ' 予約・打ち合わせを手で入れる</a></p>';
      M.innerHTML = h;
    }).catch(function (x) { M.innerHTML = err(x); });
  }

  // ----- 予約の詳細（A3〜A6・A9） -----
  var KIND = { create: '受付', paid: '入金済みにした', release: '仮押さえを外した', cancel: 'キャンセル', refund: '返金を記録', reschedule: '日時の変更', client: '相手の変更' };
  var KICON = { create: 'plus-lg', paid: 'cash-coin', release: 'x-lg', cancel: 'x-circle', refund: 'arrow-return-left', reschedule: 'arrow-left-right', client: 'person-lines-fill' };
  function histText(x) {
    var a = x.after || {}, b = x.before || {};
    if (x.kind === 'create') return (a.start_at ? a.start_at.replace('T', ' ') + '〜' + hm(a.end_at || '') : '') + (a.course ? '・' + a.course : '') + (a.amount != null && a.pay_state !== 'free' ? '・' + yen(a.amount) : '') + (a.pay_state ? '・' + payLabel(a.pay_state) : '');
    if (x.kind === 'paid') return '入金の日 ' + (a.paid_on || '');
    if (x.kind === 'reschedule') return (b.start_at || '').replace('T', ' ') + ' → ' + (a.start_at || '').replace('T', ' ') + '（' + a.change_count + '回目）';
    if (x.kind === 'cancel') return 'キャンセル料 ' + (a.cancel_rate || 0) + '%・' + yen(a.cancel_fee) + '・返す額 ' + yen(a.refund_amount) + (a.operator_fault ? '・運用者の都合' : '');
    if (x.kind === 'client') return (b.client_name || '（なし）') + ' → ' + (a.client_name || '（なし）');
    if (x.kind === 'refund') return '返した額 ' + yen(a.refund_amount) + '・振込手数料 ' + yen(a.transfer_fee) + '・' + (a.refunded_on || '');
    return '';
  }
  function mailText(v) {
    if (v === 'sent') return '<span class="badge text-bg-success">' + bi('check-lg') + ' 送信済み</span>';
    if (/^skipped: /.test(v || '')) return '送っていない（' + e(v.slice(9)) + '）';
    if (/^failed: /.test(v || '')) return '<span class="text-danger">送れなかった（' + e(v.slice(8)) + '）</span>';
    return '<span class="text-secondary">（送っていない）</span>';
  }
  function mailPlain(v) {
    if (v === 'sent') return '送信済み';
    if (v === 'none') return '送らない';
    if (/^skipped: /.test(v)) return '送っていない（' + v.slice(9) + '）';
    if (/^failed: /.test(v)) return '送れなかった（' + v.slice(8) + '）';
    return v;
  }
  function notes(r) {
    var out = [];
    if (r.meetUrl) out.push('Meet の URL：' + e(r.meetUrl));
    if (r.calendarNote) out.push('カレンダー：' + e(r.calendarNote));
    if (r.mailConfirm) out.push('予約確認メール：' + e(mailPlain(r.mailConfirm)));
    if (r.note) out.push(e(r.note));
    return out.length ? '<br><span class="small">' + out.join('<br>') + '</span>' : '';
  }
  function booking(id) {
    loading();
    Promise.all([api('booking?id=' + encodeURIComponent(id)), api('clients')]).then(function (rs) {
      var j = rs[0], cls = rs[1].clients;
      var b = j.booking, meeting = b.kind === 'meeting', live = b.status !== 'cancelled', d = b.start_at.slice(0, 10);
      var title = meeting ? e(b.name) : e(b.name) + ' 様';
      var h = crumbs([['予約', '/admin?m=' + d.slice(0, 7)], [title, '']]) + FLASH;
      FLASH = '';
      h += '<h1 class="d-flex flex-wrap align-items-center gap-2">' + title + ' ' + stBadge(b) + kindBadge(b) + srcBadge(b) + '</h1>';
      h += cardBs('calendar-event', meeting ? '打ち合わせ' : 'セッション', lg([
        liRow('予約番号', e(b.id)), liRow('日時', span(b)),
        meeting ? '' : liRow('セッション', dash(b.service_name) + (b.course_name ? '・' + e(b.course_name) : '')),
        liRow('Meet', b.meet_url ? '<a href="' + e(b.meet_url) + '" target="_blank" rel="noopener">' + e(b.meet_url) + '</a>' : '<span class="text-secondary">' + (meeting || b.status !== 'hold' ? '（付いていない）' : '（入金済みにすると付きます）') + '</span>'),
        liRow('受付', when(b.received_at) + '（' + (b.source === 'manual' ? '手で入力' : '予約画面') + '）'),
        liRow('日時の変更', b.change_count + '回' + (b.change_count >= 1 ? '<span class="small text-secondary">（無料の変更は1回まで）</span>' : ''))
      ].concat(b.cancelled_at ? [liRow('キャンセル', '<span class="text-danger">' + when(b.cancelled_at) + '</span>')] : [])));
      h += cardBs('briefcase', 'コンサルの相手', '<div class="card-body" id="clCard">' + field('clientId', 'bcl', '相手', null, '<select class="form-select" id="bcl" data-fk="clientId"><option value="">（なし）</option>' + cls.filter(function (c) { return c.visible || c.id === b.client_id; }).map(function (c) { return '<option value="' + e(c.id) + '"' + (c.id === b.client_id ? ' selected' : '') + '>' + e(c.name) + '</option>'; }).join('') + '</select>') +
        '<div id="clMsg"></div><button class="btn btn-outline-primary btn-sm" id="saveCl">' + bi('save') + ' 相手を保存</button></div>', ' data-card="client"');
      if (!meeting) h += cardBs('person-lines-fill', 'お客様', lg([liRow('Google アカウント', dash(b.google_email)), liRow('連絡用', dash(b.contact_email))]));
      // 打ち合わせは、0円でないときだけお支払いの欄を出す
      if (!meeting || b.pay_state !== 'free') {
        var pay =[liRow('料金', yen(b.amount)), liRow('支払い', payLabel(b.pay_state))];
        if (b.pay_state === 'unpaid' && b.due_date) pay.push(liRow('振込の期限', jp(b.due_date) + (overdue(b) ? ' <span class="badge text-bg-primary">期限切れ</span>' : '')));
        if (b.paid_on) pay.push(liRow('入金の日', e(b.paid_on) + (b.payer_name ? '（名義 ' + e(b.payer_name) + '）' : '')));
        if (b.cancel_rate != null) pay.push(liRow('キャンセル料', b.cancel_rate + '%・' + yen(b.cancel_fee) + (b.operator_fault ? '（運用者の都合）' : '')));
        if (b.status === 'cancelled' && b.pay_state === 'paid') pay.push(liRow('返す額', yen(b.refund_amount) + (b.refunded_on ? '（' + e(b.refunded_on) + ' に返した・振込手数料 ' + yen(b.transfer_fee) + '）' : '<span class="text-danger">（まだ返していない）</span>')));
        h += cardBs('cash-coin', 'お支払い', lg(pay), ' data-card="pay"');
      }
      if (!meeting) {
        h += cardBs('envelope', 'メール', b.source === 'manual' && !b.send_mail ? lg([liRow('お客様へ', '<span class="text-secondary">送らない（手で入れた予約）</span>'), liRow('運用者へ', mailText(b.mail_notify))]) :
          lg([liRow('振込のご案内', mailText(b.mail_hold)), liRow('予約確認', mailText(b.mail_confirm)), liRow('前日の確認', mailText(b.mail_remind)), liRow('運用者への通知', mailText(b.mail_notify))]));
        h += cardBs('shield-check', '同意', lg([liRow('個人情報', b.privacy_agreed_at ? '<span class="badge text-bg-success">' + bi('check2-circle') + ' 同意済み</span> プライバシーポリシーに同意（' + when(b.privacy_agreed_at) + '・版 ' + e(b.privacy_version) + '）' : '<span class="text-secondary">（記録なし。手で入れた予約）</span>')]));
      }
      if (b.status === 'hold' && b.pay_state === 'unpaid') {
        h += '<h2>入金を確かめた</h2><div class="card mb-3 shadow-sm"><div class="card-body" id="paidCard"><div class="row g-2"><div class="col-6">' + field('paidOn', 'pOn', '入金の日', true, '<input type="date" class="form-control" id="pOn" data-fk="paidOn" value="' + today() + '">') + '</div>' +
          '<div class="col-6">' + field('payerName', 'pNm', '振込の名義', false, input('payerName', 'pNm', '', 'autocomplete="off"')) + '</div></div>' +
          '<div id="paidMsg"></div><button class="btn btn-primary" id="doPaid">' + bi('check-lg') + ' 入金済みにする</button><div class="form-text mt-2">確定し、カレンダーの予定に Meet の URL を付け、お客様に予約確認メール、運用者に予約通知メールを送ります。</div></div></div>';
      }
      if (live) {
        h += '<h2>日時を変える</h2><div class="card mb-3 shadow-sm"><div class="card-body" id="rsCard"><div class="row g-2"><div class="col-7">' + field('date', 'rsD', '日', null, '<input type="date" class="form-control" id="rsD" data-fk="startAt" value="' + d + '">') + '</div>' +
          '<div class="col-5">' + field('time', 'rsT', '開始', null, '<input type="time" class="form-control" id="rsT" data-fk="startAt" step="300" value="' + hm(b.start_at) + '">') + '</div></div>' +
          '<div id="rsMsg"></div><button class="btn btn-outline-primary" id="doRs">' + bi('arrow-left-right') + ' この日時に変える</button><div class="form-text mt-2">長さはそのまま。カレンダーの予定も動き、Meet の URL は変わりません。お客様へのメールは送りません。</div></div></div>';
        if (b.status === 'hold') h += '<h2>仮押さえを外す</h2><div class="card mb-3 shadow-sm"><div class="card-body"><p class="text-secondary small">振込が無いときに外します。枠が戻り、カレンダーの予定を消します。お客様への知らせは、メールか LINE で送ってください。</p><button class="btn btn-outline-danger" id="doRelease">' + bi('x-lg') + ' 仮押さえを外す</button></div></div>';
        else h += '<h2>キャンセル</h2><div class="card border-danger mb-3"><div class="card-body"><p class="text-secondary small">' + (meeting ? 'この時間が空き、カレンダーの予定を消します。' : '枠が戻り、カレンダーの予定を消します。キャンセル料と返す額は、キャンセルの日から決まります。お客様へのメールは送りません。') + 'キャンセルは取り消せません。</p><button class="btn btn-outline-danger" id="doCancel">' + bi('x-circle') + ' キャンセルにする</button></div></div>';
      }
      if (b.status === 'cancelled' && b.pay_state === 'paid' && !b.refunded_on) {
        h += '<h2>返金を記録する</h2><div class="card mb-3 shadow-sm"><div class="card-body" id="rfCard"><div class="row g-2"><div class="col-6">' + field('refundedOn', 'rfOn', '返した日', true, '<input type="date" class="form-control" id="rfOn" data-fk="refundedOn" value="' + today() + '">') + '</div>' +
          (b.operator_fault ? '' : '<div class="col-6">' + field('transferFee', 'rfFee', '振込手数料（円）', true, input('transferFee', 'rfFee', '0', 'inputmode="numeric"'), '返す額から差し引きます。') + '</div>') + '</div>' +
          '<div id="rfMsg"></div><button class="btn btn-primary" id="doRefund">' + bi('save') + ' 返金を記録する</button></div></div>';
      }
      h += cardBs('clock-history', '変更履歴<span class="fw-normal small text-secondary ms-2">新しい順</span>', '<ol class="timeline">' + j.history.slice().reverse().map(function (x) {
        var t = histText(x);
        return '<li class="tl-item"><span class="tl-dot">' + bi(KICON[x.kind] || 'circle') + '</span><div class="tl-body"><div class="d-flex flex-wrap justify-content-between gap-1"><b>' + e(KIND[x.kind] || x.kind) + '</b><time class="small text-secondary">' + when(x.at) + '</time></div><div class="small text-secondary">' + bi('person') + ' ' + e(x.by) + '</div>' + (t ? '<div class="tl-detail">' + e(t) + '</div>' : '') + '</div></li>';
      }).join('') + '</ol>', ' id="history"');
      M.innerHTML = h;
      var again = function (html) { FLASH = html; booking(b.id); };
      var sc = document.getElementById('saveCl');
      sc.onclick = function () {
        busy(sc, api('booking-client', { id: b.id, clientId: val('bcl') })).then(function () { again(okBox('相手を保存しました。')); }).catch(function (x) { fail(document.getElementById('clCard'), document.getElementById('clMsg'), x); });
      };
      var pb = document.getElementById('doPaid');
      if (pb) pb.onclick = function () {
        var box = document.getElementById('paidCard'), out = document.getElementById('paidMsg');
        out.innerHTML = '';
        busy(pb, api('paid', { id: b.id, paidOn: val('pOn'), payerName: val('pNm') })).then(function (r) { again(okBox('入金済みにして、確定しました。' + notes(r))); }).catch(function (x) { fail(box, out, x); });
      };
      var rs = document.getElementById('doRs');
      if (rs) {
        var ack = false, force = false;
        var reset = function () { ack = false; force = false; rs.innerHTML = bi('arrow-left-right') + ' この日時に変える'; document.getElementById('rsMsg').innerHTML = ''; };
        document.getElementById('rsD').onchange = reset; document.getElementById('rsT').onchange = reset;
        rs.onclick = function () {
          var out = document.getElementById('rsMsg'), box = document.getElementById('rsCard');
          busy(rs, api('reschedule', { id: b.id, startAt: val('rsD') + 'T' + val('rsT'), ack: ack, force: force })).then(function (r) {
            if (r.needAck) { ack = true; out.innerHTML = warn(r.error + '。2回目からの扱い（料金など）をお客様と決めてから、もう一度押してください。'); rs.innerHTML = bi('arrow-left-right') + ' 決めたので変える'; return; }
            if (r.needForce) { force = true; out.innerHTML = warn(r.error + '。このまま入れるなら、もう一度押してください。'); rs.innerHTML = bi('arrow-left-right') + ' ぶつかっても変える'; return; }
            again(okBox('日時を変えました（' + e(r.start_at.replace('T', ' ')) + '〜' + e(hm(r.end_at)) + '）。' + notes(r)));
          }).catch(function (x) { fail(box, out, x); });
        };
      }
      var rl = document.getElementById('doRelease');
      if (rl) rl.onclick = function () {
        ask(bi('exclamation-triangle-fill') + ' 仮押さえを外しますか？', '<p class="mb-2"><b>' + title + '（' + e(b.id) + '）</b><br>' + span(b) + '</p><p class="mb-0">枠が戻り、カレンダーの予定を消します。<b class="text-danger">外すと戻せません。</b></p>', '仮押さえを外す', true, function () {
          api('release', { id: b.id }).then(function (r) { again(okBox('仮押さえを外しました。お客様への知らせを送ってください。' + notes(r))); }).catch(topErr);
        });
      };
      var cb = document.getElementById('doCancel');
      if (cb) cb.onclick = function () {
        ask(bi('exclamation-triangle-fill') + ' この予約をキャンセルにしますか？', '<p class="mb-2"><b>' + title + '（' + e(b.id) + '）</b><br>' + span(b) + '</p>' + (meeting ? '' : check('cFault', '運用者の都合でのキャンセル（キャンセル料なし・振込手数料も差し引かず全額を返す）', false)) + '<p class="mb-0"><b class="text-danger">キャンセルは取り消せません。</b></p>', 'キャンセルにする', true, function () {
          var f = document.getElementById('cFault');
          api('cancel', { id: b.id, operatorFault: !!(f && f.checked) }).then(function (r) {
            again(okBox('キャンセルにしました。' + (meeting ? '' : 'キャンセル料 ' + r.rate + '%・' + yen(r.fee) + '・返す額 ' + yen(r.refund) + '。') + notes(r)));
          }).catch(topErr);
        });
      };
      var rf = document.getElementById('doRefund');
      if (rf) rf.onclick = function () {
        var box = document.getElementById('rfCard'), out = document.getElementById('rfMsg'), fee = document.getElementById('rfFee');
        out.innerHTML = '';
        var tf = fee ? fee.value.trim() : '0';
        if (!/^\d+$/.test(tf)) { showErrs(box, { transferFee: '振込手数料は 0〜1000 円の整数で入れてください' }); return; }
        busy(rf, api('refund', { id: b.id, transferFee: +tf, refundedOn: val('rfOn') })).then(function (r) { again(okBox('返金を記録しました（' + yen(r.refund) + '）。')); }).catch(function (x) { fail(box, out, x); });
      };
    }).catch(function (x) { M.innerHTML = err(x); });
  }

  // ----- 予約・打ち合わせを手で入れる（A7） -----
  function addForm(d) {
    loading();
    Promise.all([api('catalog'), api('clients')]).then(function (rs) {
      var j = rs[0], cls = rs[1].clients.filter(function (c) { return c.visible; });
      var courses = [];
      j.services.forEach(function (s) { s.courses.forEach(function (c) { courses.push({ id: c.id, label: s.name + '・' + c.name + '（' + yen(c.price) + '）' + (s.visible && c.visible ? '' : '（予約画面に出していない）'), minutes: s.minutes }); }); });
      var h = crumbs([['予約', '/admin'], ['手で入れる', '']]) + '<h1>予約・打ち合わせを手で入れる</h1><div class="card shadow-sm mb-3"><div class="card-body" id="addCard">' +
        '<div class="mb-3"><span class="form-label d-block">種類<span class="req">必須</span></span><div class="btn-group" role="group" aria-label="種類"><input type="radio" class="btn-check" name="kind" id="kS" value="session" checked><label class="btn btn-outline-primary" for="kS">セッション</label><input type="radio" class="btn-check" name="kind" id="kM" value="meeting"><label class="btn btn-outline-primary" for="kM">打ち合わせ</label></div>' + errBox('kind') + '</div>' +
        '<div class="row g-2"><div class="col-7">' + field('startAt', 'aD', '日', true, '<input type="date" class="form-control" id="aD" data-fk="startAt" value="' + e(d || today()) + '">') + '</div><div class="col-5">' + field('startAtTime', 'aT', '開始', true, '<input type="time" class="form-control" id="aT" data-fk="startAt" step="300" value="10:00">') + '</div></div>' +
        field('minutes', 'aMin', '長さ（分）', true, input('minutes', 'aMin', courses[0] ? courses[0].minutes : 90, 'inputmode="numeric"')) +
        '<div id="sOnly">' + field('courseId', 'aC', 'コース', false, '<select class="form-select" id="aC" data-fk="courseId"><option value="">（コースなし）</option>' + courses.map(function (c, i) { return '<option value="' + e(c.id) + '"' + (i === 0 ? ' selected' : '') + '>' + e(c.label) + '</option>'; }).join('') + '</select>', 'コースを選ぶと、料金はコースの料金になります。') +
        '</div>' +
        field('payState', 'aPay', 'お金', true, '<select class="form-select" id="aPay" data-fk="payState"><option value="unpaid">未入金（仮押さえ）</option><option value="paid">入金済み（確定）</option><option value="free">0円（確定・売上に数えない）</option></select>') +
        '<div id="amtBox" hidden>' + field('amount', 'aAmt', '料金（税込・円）', true, input('amount', 'aAmt', '', 'inputmode="numeric"'), 'コースを選ばないときに入れます。') + '</div>' +
        field('name', 'aNm', '<span id="nmLabel">相手の名前</span>', true, input('name', 'aNm', '', 'autocomplete="off"')) +
        field('clientId', 'aCl', 'コンサルの相手', false, '<select class="form-select" id="aCl" data-fk="clientId"><option value="">（選ばない）</option>' + cls.map(function (c) { return '<option value="' + e(c.id) + '">' + e(c.name) + '</option>'; }).join('') + '</select>', '相手ごとの回数に数えます。') +
        field('newClientName', 'aNc', 'その場で新しい相手を作る', false, input('newClientName', 'aNc', '', 'autocomplete="off"'), '名前を入れると作って付けます。上で相手を選んだときは使いません。') +
        '<div id="mailBox">' + field('googleEmail', 'aG', 'Google アカウントのメールアドレス', false, input('googleEmail', 'aG', '', 'inputmode="email" autocomplete="off"')) +
        field('contactEmail', 'aCe', '連絡用のメールアドレス', false, input('contactEmail', 'aCe', '', 'inputmode="email" autocomplete="off"'), 'あれば、お客様へのメールはこちらに送ります。') +
        check('aSend', 'お客様にメールを送る（未入金なら振込のご案内、入金済みなら予約確認）', false) + '</div>' +
        '<div id="meetBox">' + check('aMeet', 'Meet の URL を付ける', true) + '</div><p class="form-text" id="meetLater" hidden>Meet の URL は、入金済みにしたときに付きます。</p>' +
        '<div id="aMsg"></div><div class="d-grid gap-2 d-sm-flex mt-3"><button class="btn btn-primary" id="add">' + bi('check-lg') + ' 入れる</button><a class="btn btn-outline-secondary" href="/admin" data-go>やめる</a></div><div class="form-text mt-2">枠を開けていない時間にも入れられます。カレンダーに予定を入れます。</div></div></div>';
      M.innerHTML = h;
      var force = false, btn = document.getElementById('add');
      var kind = function () { return checked('kM') ? 'meeting' : 'session'; };
      // 種類を切り替えたとき：打ち合わせはお金を「0円」、Meet の URL を付けないを初めの値にする（要件 5節）
      var setKind = function () {
        var m = kind() === 'meeting';
        document.getElementById('aPay').value = m ? 'free' : 'unpaid';
        document.getElementById('aMeet').checked = !m;
        sync(); unforce();
      };
      var sync = function () {
        var m = kind() === 'meeting', unpaid = val('aPay') === 'unpaid';
        document.getElementById('sOnly').hidden = m;
        document.getElementById('mailBox').hidden = m;
        document.getElementById('nmLabel').textContent = m ? '題' : '相手の名前';
        document.getElementById('amtBox').hidden = val('aPay') === 'free' || (!m && !!val('aC'));
        // 未入金のセッションは、入金済みにしたときに Meet の URL が付く（ここでは選べない）
        document.getElementById('meetBox').hidden = unpaid && !m;
        document.getElementById('meetLater').hidden = !(unpaid && !m);
      };
      var unforce = function () { force = false; btn.innerHTML = bi('check-lg') + ' 入れる'; document.getElementById('aMsg').innerHTML = ''; };
      document.getElementById('kS').onchange = setKind;
      document.getElementById('kM').onchange = setKind;
      document.getElementById('aPay').onchange = sync;
      document.getElementById('aC').onchange = function () {
        var c = courses.filter(function (x) { return x.id === val('aC'); })[0];
        if (c) document.getElementById('aMin').value = c.minutes;
        sync();
      };
      ['aD', 'aT', 'aMin'].forEach(function (k) { document.getElementById(k).addEventListener('change', unforce); });
      sync();
      btn.onclick = function () {
        var box = document.getElementById('addCard'), out = document.getElementById('aMsg'), m = kind() === 'meeting';
        var body = { kind: kind(), startAt: val('aD') + 'T' + val('aT'), minutes: Number(val('aMin')), name: val('aNm'), payState: val('aPay'), amount: val('aAmt'), withMeet: checked('aMeet'), force: force, clientId: val('aCl'), newClientName: val('aNc') };
        if (!m) { body.courseId = val('aC'); body.googleEmail = val('aG'); body.contactEmail = val('aCe'); body.sendMail = checked('aSend'); }
        out.innerHTML = '';
        busy(btn, api('manual', body)).then(function (r) {
          if (r.needForce) { force = true; out.innerHTML = warn(r.error); btn.innerHTML = bi('check-lg') + ' ぶつかっても入れる'; return; }
          FLASH = okBox('入れました。' + notes(r));
          go('/admin/b/' + encodeURIComponent(r.id));
        }).catch(function (x) { fail(box, out, x); });
      };
    }).catch(function (x) { M.innerHTML = err(x); });
  }

  // ----- 枠（A1・A2） -----
  function slots() {
    loading();
    var t = today(), to = addDays(t, 60);
    Promise.all([api('slots?from=' + t + '&to=' + to), api('rules'), api('catalog')]).then(function (r) {
      var open = r[0].slots.filter(function (s) { return s.state === 'open'; }), rules = r[1].rules;
      var mins = r[2].services[0] ? r[2].services[0].minutes : 90;
      var h = '<h1>枠</h1>';
      h += cardBs('plus-square', '枠を開ける', '<div class="card-body" id="opCard"><div class="row g-2"><div class="col-12 col-sm-5">' + field('startAt', 'oD', '日', null, '<input type="date" class="form-control" id="oD" data-fk="startAt" value="' + addDays(t, 7) + '">') + '</div>' +
        '<div class="col-6 col-sm-4">' + field('startAtTime', 'oT', '開始', null, '<input type="time" class="form-control" id="oT" data-fk="startAt" step="300" value="10:00">') + '</div><div class="col-6 col-sm-3">' + field('minutes', 'oM', '長さ（分）', null, input('minutes', 'oM', mins, 'inputmode="numeric"')) + '</div></div>' +
        '<div id="opMsg"></div><button class="btn btn-primary" id="doOpen">' + bi('plus-lg') + ' 開ける</button><div class="form-text mt-2">開けると、予約画面にすぐ出ます（カレンダーに予定がある時間と、受付の締め切りより前は出ません）。</div></div>');
      var days = {};
      open.forEach(function (s) { var d = s.start_at.slice(0, 10); (days[d] = days[d] || []).push(s); });
      var keys = Object.keys(days).sort();
      h += cardBs('calendar-week', '開いている枠（60日先まで）', keys.length ? '<ul class="list-group list-group-flush">' + keys.map(function (d) {
        return '<li class="list-group-item"><div class="fw-bold mb-1">' + jp(d) + '</div>' + days[d].map(function (s) {
          var end = new Date(new Date(s.start_at + ':00Z').getTime() + s.minutes * 60000).toISOString().slice(11, 16);
          return '<div class="d-flex flex-wrap align-items-center gap-2 py-1" data-slot="' + e(s.id) + '"><span>' + hm(s.start_at) + '〜' + end + '</span>' + (s.rule_id ? '<span class="badge text-bg-light border">毎週</span>' : '') +
            (s.booking_id ? '<a class="badge text-bg-success text-decoration-none" href="/admin/b/' + encodeURIComponent(s.booking_id) + '" data-go>' + bi('person-check') + ' 予約あり</a>' : '<button class="btn btn-outline-secondary btn-sm ms-auto" data-close="' + e(s.id) + '">閉じる</button>') + '</div>';
        }).join('') + '</li>';
      }).join('') + '</ul>' : '<div class="card-body text-secondary">開いている枠はありません。</div>', ' data-card="open"');
      h += cardBs('arrow-repeat', '毎週くり返す枠', (rules.length ? '<ul class="list-group list-group-flush">' + rules.map(function (x) {
        return '<li class="list-group-item" data-rule="' + e(x.id) + '"><div class="fw-bold">毎週' + W[x.weekday] + '曜 ' + e(x.start_time) + '〜（' + x.minutes + '分）</div><div class="small text-secondary mb-2">' + e(x.from_date) + ' から' + (x.to_date ? ' ' + e(x.to_date) + ' まで' : '（終わりなし）') + '</div>' +
          '<div class="d-flex flex-wrap align-items-center gap-2"><label class="small" for="re-' + e(x.id) + '">終わりの日</label><input type="date" class="form-control form-control-sm" style="max-width:11rem" id="re-' + e(x.id) + '" value="' + e(x.to_date || t) + '"><button class="btn btn-outline-secondary btn-sm" data-end="' + e(x.id) + '">この日で終える</button></div></li>';
      }).join('') + '</ul>' : '<div class="card-body text-secondary pb-0">まだありません。</div>') +
        '<div class="card-body border-top" id="ruCard"><div class="fw-bold mb-2">くり返しを足す</div><div class="row g-2"><div class="col-4">' + field('weekday', 'uW', '曜日', null, '<select class="form-select" id="uW" data-fk="weekday">' + W.split('').map(function (w, i) { return '<option value="' + i + '"' + (i === 6 ? ' selected' : '') + '>' + w + '</option>'; }).join('') + '</select>') + '</div>' +
        '<div class="col-4">' + field('startTime', 'uT', '開始', null, '<input type="time" class="form-control" id="uT" data-fk="startTime" step="300" value="10:00">') + '</div><div class="col-4">' + field('minutes', 'uM', '長さ（分）', null, input('minutes', 'uM', mins, 'inputmode="numeric"')) + '</div>' +
        '<div class="col-6">' + field('fromDate', 'uF', 'から', null, '<input type="date" class="form-control" id="uF" data-fk="fromDate" value="' + t + '">') + '</div><div class="col-6">' + field('toDate', 'uTo', 'まで', false, '<input type="date" class="form-control" id="uTo" data-fk="toDate">') + '</div></div>' +
        '<div id="ruMsg"></div><button class="btn btn-primary" id="doRule">' + bi('plus-lg') + ' 足す</button><div class="form-text mt-2">60日先までの枠を作ります。その先は毎日0時に足していきます。</div></div>');
      h += '<div id="slMsg"></div>';
      M.innerHTML = h;
      var msg = document.getElementById('slMsg');
      var ob = document.getElementById('doOpen');
      ob.onclick = function () {
        var box = document.getElementById('opCard'), out = document.getElementById('opMsg');
        out.innerHTML = '';
        busy(ob, api('slot', { startAt: val('oD') + 'T' + val('oT'), minutes: Number(val('oM')) })).then(slots).catch(function (x) { fail(box, out, x); });
      };
      M.querySelectorAll('[data-close]').forEach(function (c) {
        c.onclick = function () { busy(c, api('slot-close', { id: c.getAttribute('data-close') })).then(slots).catch(function (x) { msg.innerHTML = err(x); msg.scrollIntoView(); }); };
      });
      M.querySelectorAll('[data-end]').forEach(function (c) {
        c.onclick = function () {
          var id = c.getAttribute('data-end'), to = val('re-' + id);
          ask('くり返しを ' + e(to) + ' で終えますか？', '<p class="mb-0">' + e(to) + ' より後の、予約の入っていない枠を閉じます。予約の入っている枠はそのままです。</p>', '終える', false, function () {
            api('rule-end', { id: id, toDate: to }).then(slots).catch(function (x) { msg.innerHTML = err(x); msg.scrollIntoView(); });
          });
        };
      });
      var rb = document.getElementById('doRule');
      rb.onclick = function () {
        var box = document.getElementById('ruCard'), out = document.getElementById('ruMsg');
        out.innerHTML = '';
        busy(rb, api('rule', { weekday: Number(val('uW')), startTime: val('uT'), minutes: Number(val('uM')), fromDate: val('uF'), toDate: val('uTo') || null })).then(slots).catch(function (x) { fail(box, out, x); });
      };
    }).catch(function (x) { M.innerHTML = err(x); });
  }

  // ----- 相手（F18・F19：相手の登録・月額の契約・月ごとの入金済み） -----
  function clientFields(c, p) {
    p = e(p);
    return field('name', p + '-n', '相手の名前', true, input('name', p + '-n', c.name, 'data-k="name" autocomplete="off"')) +
      field('memo', p + '-m', 'メモ', false, '<textarea class="form-control" id="' + p + '-m" data-fk="memo" data-k="memo" rows="2">' + e(c.memo) + '</textarea>') +
      check(p + '-v', '手で入れる予約の選び肢に出す', !!c.visible, 'data-k="visible"');
  }
  function contractFields(k, p) {
    p = e(p);
    return '<div class="row g-2"><div class="col-12 col-sm-6">' + field('name', p + '-n', '契約の名前', true, input('name', p + '-n', k.name, 'data-k="name" autocomplete="off"')) + '</div>' +
      '<div class="col-12 col-sm-6">' + field('monthlyAmount', p + '-a', '月額（税込・円）', true, input('monthlyAmount', p + '-a', k.monthly_amount, 'data-k="monthlyAmount" inputmode="numeric"')) + '</div>' +
      '<div class="col-6">' + field('startMonth', p + '-s', '始まりの月', true, '<input type="month" class="form-control" id="' + p + '-s" data-fk="startMonth" data-k="startMonth" value="' + e(k.start_month) + '">') + '</div>' +
      '<div class="col-6">' + field('endMonth', p + '-e', '終わりの月', false, '<input type="month" class="form-control" id="' + p + '-e" data-fk="endMonth" data-k="endMonth" value="' + e(k.end_month) + '">', '空なら続きます。') + '</div>' +
      '<div class="col-12">' + field('memo', p + '-m', 'メモ', false, '<textarea class="form-control" id="' + p + '-m" data-fk="memo" data-k="memo" rows="2">' + e(k.memo) + '</textarea>') + '</div></div>';
  }
  function clientBody(box) { var o = grab(box); return { name: o.name, memo: o.memo, visible: o.visible }; }
  function contractBody(box) { var o = grab(box); return { name: o.name, monthlyAmount: o.monthlyAmount.trim(), startMonth: o.startMonth, endMonth: o.endMonth, memo: o.memo }; }
  /** 契約の月ごとの入金（始まりの月から、今月か終わりの月まで。新しい月が上） */
  function payList(k, cur) {
    var last = k.end_month && k.end_month < cur ? k.end_month : cur, ms = [], m = k.start_month;
    if (last < m) last = m;
    while (m <= last && ms.length < 36) { ms.push(m); m = shiftMonth(m, 1); }
    ms.reverse();
    return '<ul class="list-group list-group-flush mt-3 border-top" data-pays="' + e(k.id) + '">' + ms.map(function (mo) {
      var pay = k.payments.filter(function (x) { return x.month === mo; })[0], done = !!(pay && pay.paid_on), id = e(k.id) + '-' + mo;
      return '<li class="list-group-item d-flex flex-wrap align-items-center gap-2" data-month="' + mo + '"><b>' + monthLabel(mo) + '</b>' +
        (done ? '<span class="badge text-bg-success">' + bi('check-circle-fill') + ' 入金済み</span><span class="small">' + yen(pay.amount) + '・' + e(pay.paid_on) + '</span><button class="btn btn-outline-secondary btn-sm ms-auto" data-unpay="' + e(k.id) + '" data-m="' + mo + '">入金済みを外す</button>' :
          '<span class="badge text-bg-light border">' + bi('hourglass-split') + ' 未入金</span><div class="ms-auto d-flex flex-wrap align-items-center gap-2"><input class="form-control form-control-sm" style="max-width:7rem" id="pa-' + id + '" value="' + (pay ? pay.amount : k.monthly_amount) + '" inputmode="numeric" aria-label="金額（円）"><input type="date" class="form-control form-control-sm" style="max-width:10rem" id="pd-' + id + '" value="' + today() + '" aria-label="入金の日"><button class="btn btn-outline-primary btn-sm" data-pay="' + e(k.id) + '" data-m="' + mo + '">入金済みにする</button></div>') + '</li>';
    }).join('') + '</ul>';
  }
  function clients() {
    loading();
    api('clients').then(function (r) {
      var cur = today().slice(0, 7);
      var h = '<h1>相手</h1>' + FLASH;
      FLASH = '';
      h += '<p class="form-text">コンサルの相手と、月額の契約。請求も入金の確かめも自動ではしません。通帳と照らして、月ごとに「入金済みにする」を押します。</p>';
      h += cardBs('person-plus', '相手を足す', '<div class="card-body" id="ncCard">' + clientFields({ visible: 1 }, 'nc') + '<div data-msg></div><button class="btn btn-primary btn-sm" id="addClient">' + bi('plus-lg') + ' 足す</button></div>', ' data-card="new-client"');
      h += r.clients.length ? r.clients.map(function (c) {
        return '<div class="card mb-3 shadow-sm" data-client="' + e(c.id) + '"><div class="card-header fw-bold">' + bi('briefcase') + ' ' + e(c.name) + (c.visible ? '' : ' <span class="badge text-bg-secondary">選び肢に出さない</span>') + '</div>' +
          '<div class="card-body" id="cl-' + e(c.id) + '">' + clientFields(c, 'cl-' + c.id) + '<div data-msg></div><button class="btn btn-outline-primary btn-sm" data-save-client="' + e(c.id) + '">' + bi('save') + ' 相手を保存</button></div>' +
          c.contracts.map(function (k) {
            return '<div class="card-body border-top" id="ct-' + e(k.id) + '" data-contract="' + e(k.id) + '"><div class="fw-bold mb-2">' + bi('file-earmark-text') + ' ' + e(k.name) + '<span class="small text-secondary ms-2">' + yen(k.monthly_amount) + '／月・' + e(k.start_month) + ' から' + (k.end_month ? ' ' + e(k.end_month) + ' まで' : '（続く）') + '</span></div>' + contractFields(k, 'ct-' + k.id) +
              '<div data-msg></div><button class="btn btn-outline-primary btn-sm" data-save-contract="' + e(k.id) + '">' + bi('save') + ' 契約を保存</button>' + payList(k, cur) + '</div>';
          }).join('') +
          '<div class="card-body border-top" id="kn-' + e(c.id) + '"><div class="fw-bold mb-2">月額の契約を足す</div>' + contractFields({ start_month: cur }, 'kn-' + c.id) + '<div data-msg></div><button class="btn btn-outline-primary btn-sm" data-add-contract="' + e(c.id) + '">' + bi('plus-lg') + ' 契約を足す</button></div></div>';
      }).join('') : '<div class="alert alert-light border">相手はまだいません。</div>';
      M.innerHTML = h;
      var saved = function (t) { FLASH = okBox(t); clients(); };
      var send = function (btn, box, path, body, text) {
        busy(btn, api(path, body)).then(function () { saved(text); }).catch(function (x) { fail(box, box.querySelector('[data-msg]'), x); });
      };
      var ac = document.getElementById('addClient');
      ac.onclick = function () { var box = document.getElementById('ncCard'); send(ac, box, 'client', clientBody(box), '相手を足しました。'); };
      M.querySelectorAll('[data-save-client]').forEach(function (b) {
        var id = b.getAttribute('data-save-client');
        b.onclick = function () { var box = document.getElementById('cl-' + id), body = clientBody(box); body.id = id; send(b, box, 'client', body, '相手を保存しました。'); };
      });
      M.querySelectorAll('[data-add-contract]').forEach(function (b) {
        var id = b.getAttribute('data-add-contract');
        b.onclick = function () { var box = document.getElementById('kn-' + id), body = contractBody(box); body.clientId = id; send(b, box, 'contract', body, '契約を足しました。'); };
      });
      M.querySelectorAll('[data-save-contract]').forEach(function (b) {
        var id = b.getAttribute('data-save-contract');
        b.onclick = function () {
          var box = document.getElementById('ct-' + id), body = contractBody(box);
          body.id = id; body.clientId = box.closest('[data-client]').getAttribute('data-client');
          send(b, box, 'contract', body, '契約を保存しました。');
        };
      });
      M.querySelectorAll('[data-pay]').forEach(function (b) {
        var k = b.getAttribute('data-pay'), mo = b.getAttribute('data-m'), id = k + '-' + mo;
        b.onclick = function () {
          busy(b, api('contract-pay', { contractId: k, month: mo, amount: val('pa-' + id).trim(), paidOn: val('pd-' + id) })).then(function () { saved(monthLabel(mo) + 'を入金済みにしました。'); }).catch(topErr);
        };
      });
      M.querySelectorAll('[data-unpay]').forEach(function (b) {
        var k = b.getAttribute('data-unpay'), mo = b.getAttribute('data-m');
        b.onclick = function () {
          ask(bi('exclamation-triangle-fill') + ' 入金済みを外しますか？', '<p class="mb-0">' + monthLabel(mo) + 'を未入金に戻します。売上の数からも外れます。</p>', '外す', true, function () {
            api('contract-unpay', { contractId: k, month: mo }).then(function () { saved(monthLabel(mo) + 'の入金済みを外しました。'); }).catch(topErr);
          });
        };
      });
    }).catch(function (x) { M.innerHTML = err(x); });
  }

  // ----- 売上（確定した予約。セッションの月ごと。0円と、名前に「テスト」「試験」を含む予約は数えない） -----
  function stats() {
    loading();
    var cur = today().slice(0, 7), months = [];
    for (var i = -5; i <= 2; i++) months.push(shiftMonth(cur, i));
    var pm = new URLSearchParams(location.search).get('m');
    var pick = /^\d{4}-\d{2}$/.test(pm || '') ? pm : cur;
    Promise.all(months.map(function (m) { return api('stats?month=' + m); }).concat([api('client-stats?month=' + pick)])).then(function (all) {
      var list = all.slice(0, months.length), per = all[months.length];
      var max = Math.max.apply(null, list.map(function (x) { return x.total; }).concat([1]));
      var h = '<h1>売上</h1><p class="form-text">セッションの月ごと。入金済みで確定した予約と、受け取ったキャンセル料（50%・100%）、月額の契約の入金（入金の日の月）を足した額。0円の予約と、名前に「テスト」「試験」を含む予約は数えません。</p>';
      h += cardBs('bar-chart-fill', '月別の売上', '<div class="card-body bs-bars">' + list.map(function (x) {
        var w = x.total / max * 100;
        var fee = (x.cancelFee > 0 ? '<div class="small text-secondary text-end" style="margin:-.35rem 0 .5rem">うちキャンセル料 ' + x.cancelCount + '件 ' + yen(x.cancelFee) + '</div>' : '') +
          (x.contractAmount > 0 ? '<div class="small text-secondary text-end" style="margin:-.35rem 0 .5rem" data-contract-line>うち月額の契約 ' + x.contractCount + '件 ' + yen(x.contractAmount) + '</div>' : '');
        return '<div class="d-flex align-items-center gap-2 mb-2" data-bar="' + e(x.month) + '"><span class="bar-label">' + monthLabel(x.month) + (x.month === cur ? '<span class="small text-secondary">（今月）</span>' : '') + '</span><div class="progress flex-grow-1" role="progressbar" aria-label="' + monthLabel(x.month) + 'の売上" aria-valuenow="' + Math.round(w) + '" aria-valuemin="0" aria-valuemax="100"><div class="progress-bar" style="width:' + w + '%"></div></div>' +
          '<span class="text-end small" style="flex:0 0 3em">' + x.count + '件</span><span class="fw-bold text-end" style="flex:0 0 6.2em;font-size:.8125rem">' + yen(x.total) + '</span></div>' + fee;
      }).join('') + '</div>');
      h += '<div class="d-flex justify-content-between align-items-center gap-2 mb-2"><a class="btn btn-outline-secondary btn-sm" href="/admin/stats?m=' + shiftMonth(pick, -1) + '" data-go>' + bi('chevron-left') + ' 前の月</a><h2 class="mb-0">相手ごと ' + monthLabel(pick) + '</h2><a class="btn btn-outline-secondary btn-sm" href="/admin/stats?m=' + shiftMonth(pick, 1) + '" data-go>次の月 ' + bi('chevron-right') + '</a></div>';
      h += cardBs('people', '相手ごとの集計', per.rows.length ? '<div class="table-responsive"><table class="table table-sm mb-0 align-middle" data-client-stats><thead><tr><th>相手</th><th class="text-end">回数</th><th class="text-end">予約の売上</th><th class="text-end">月額の契約</th><th class="text-end">合計</th></tr></thead><tbody>' +
        per.rows.map(function (x) { return '<tr data-client-row="' + e(x.clientId) + '"><td>' + e(x.name) + '</td><td class="text-end">' + x.count + '回</td><td class="text-end">' + yen(x.bookingAmount) + '</td><td class="text-end">' + yen(x.contractAmount) + '</td><td class="text-end fw-bold">' + yen(x.total) + '</td></tr>'; }).join('') +
        '</tbody></table></div><div class="card-body py-2 small text-secondary">回数は確定した予約・打ち合わせ（キャンセルは数えません）。月額の契約は入金の日の月で数えます。</div>' : '<div class="card-body text-secondary">この月の相手ごとの数はありません。</div>', ' data-card="client-stats"');
      M.innerHTML = h;
    }).catch(function (x) { M.innerHTML = err(x); });
  }

  // ----- 設定（A8） -----
  function settings() {
    loading();
    Promise.all([api('settings'), api('calendars'), api('catalog')]).then(function (r) {
      var s = r[0].settings, cals = r[1].calendars, connected = r[1].connected, services = r[2].services;
      var h = '<h1>設定</h1>' + FLASH;
      FLASH = '';
      h += cardBs('sliders', '予約の受け方', '<div class="card-body" id="rcCard"><div class="row g-2"><div class="col-12 col-sm-4">' + field('bufferMinutes', 'sBuf', '前後に空ける時間（分）', null, input('bufferMinutes', 'sBuf', s.bufferMinutes, 'inputmode="numeric"')) + '</div>' +
        '<div class="col-6 col-sm-4">' + field('leadDays', 'sLead', '受付の締め切り（何日前まで）', null, input('leadDays', 'sLead', s.leadDays, 'inputmode="numeric"')) + '</div><div class="col-6 col-sm-4">' + field('horizonDays', 'sHor', '受付の先（何日先まで）', null, input('horizonDays', 'sHor', s.horizonDays, 'inputmode="numeric"')) + '</div></div>' +
        '<div id="rcMsg"></div><button class="btn btn-primary" id="saveRc">' + bi('save') + ' 保存する</button></div>');
      h += cardBs('calendar3', 'Google カレンダー', '<div class="card-body" id="gcCard">' + (connected ? (cals.length ? '<p class="small text-secondary">印を付けたカレンダーに予定がある時間は、予約画面に出しません（予定の題や中身は読みません）。</p><fieldset class="mb-3"><legend class="form-label fs-6">空きを見るカレンダー</legend>' + cals.map(function (c, i) {
          return check('gc' + i, e(c.name) + (c.primary ? '<span class="small text-secondary">（メイン）</span>' : ''), s.calendars.indexOf(c.id) >= 0, 'data-cal="' + e(c.id) + '"');
        }).join('') + '</fieldset>' + field('eventCalendar', 'gEv', '予定を入れるカレンダー', null, '<select class="form-select" id="gEv" data-fk="eventCalendar">' + cals.map(function (c) { return '<option value="' + e(c.id) + '"' + (c.id === s.eventCalendar || (s.eventCalendar === 'primary' && c.primary) ? ' selected' : '') + '>' + e(c.name) + '</option>'; }).join('') + '</select>') +
          '<div id="gcMsg"></div><button class="btn btn-primary" id="saveGc">' + bi('save') + ' 保存する</button>' : '<p class="mb-0 text-secondary">見られるカレンダーがありません。</p>')
        : '<p class="mb-0">' + bi('exclamation-circle') + ' Google カレンダーにつながっていません。空きの確かめ・予定・Meet の URL は使えません。</p>') + '</div>', ' data-card="calendar"');
      h += cardBs('bank', '振込先', '<div class="card-body" id="bkCard">' + field('bank', 'sBank', '振込先の口座', null, '<textarea class="form-control" id="sBank" data-fk="bank" rows="3" autocomplete="off">' + e(s.bank) + '</textarea>', 'お客様への振込のご案内（画面とメール）に、この文のまま出ます。500文字まで。') +
        '<div id="bkMsg"></div><button class="btn btn-primary" id="saveBk">' + bi('save') + ' 保存する</button></div>', ' data-card="bank"');
      h += '<h2>セッションとコース</h2>' + services.map(function (sv) {
        return '<div class="card mb-3 shadow-sm" data-service="' + e(sv.id) + '"><div class="card-body" id="sv-' + e(sv.id) + '">' + serviceFields(sv, 'sv-' + sv.id) +
          '<div data-msg></div><button class="btn btn-outline-primary btn-sm" data-save-service="' + e(sv.id) + '">' + bi('save') + ' セッションを保存</button></div>' +
          '<ul class="list-group list-group-flush border-top">' + sv.courses.map(function (c) {
            return '<li class="list-group-item" id="co-' + e(c.id) + '">' + courseFields(c, 'co-' + c.id) + '<div data-msg></div><button class="btn btn-outline-primary btn-sm" data-save-course="' + e(c.id) + '">' + bi('save') + ' コースを保存</button></li>';
          }).join('') +
          '<li class="list-group-item" id="nc-' + e(sv.id) + '"><div class="fw-bold mb-2">コースを足す</div>' + courseFields({ visible: 1, sort_order: sv.courses.length + 1 }, 'nc-' + sv.id) + '<div data-msg></div><button class="btn btn-outline-primary btn-sm" data-add-course="' + e(sv.id) + '">' + bi('plus-lg') + ' 足す</button></li></ul></div>';
      }).join('') +
        '<div class="card mb-3 shadow-sm"><div class="card-body" id="nsCard"><div class="fw-bold mb-2">セッションを足す</div>' + serviceFields({ minutes: 90, visible: 1, sort_order: services.length + 1 }, 'ns') + '<div data-msg></div><button class="btn btn-outline-primary btn-sm" id="addService">' + bi('plus-lg') + ' 足す</button></div></div>';
      M.innerHTML = h;
      var saved = function (t) { FLASH = okBox(t); settings(); };
      var sb = document.getElementById('saveRc');
      sb.onclick = function () {
        busy(sb, api('settings', { bufferMinutes: val('sBuf'), leadDays: val('sLead'), horizonDays: val('sHor') })).then(function () { saved('予約の受け方を保存しました。'); }).catch(function (x) { fail(document.getElementById('rcCard'), document.getElementById('rcMsg'), x); });
      };
      var gb = document.getElementById('saveGc');
      if (gb) gb.onclick = function () {
        var ids = []; M.querySelectorAll('[data-cal]').forEach(function (c) { if (c.checked) ids.push(c.getAttribute('data-cal')); });
        busy(gb, api('settings', { calendars: ids, eventCalendar: val('gEv') })).then(function () { saved('カレンダーの設定を保存しました。'); }).catch(function (x) { fail(document.getElementById('gcCard'), document.getElementById('gcMsg'), x); });
      };
      var bb = document.getElementById('saveBk');
      bb.onclick = function () {
        busy(bb, api('settings', { bank: val('sBank') })).then(function () { saved('振込先を保存しました。'); }).catch(function (x) { fail(document.getElementById('bkCard'), document.getElementById('bkMsg'), x); });
      };
      var sendSv = function (btn, box, id) {
        busy(btn, api('service', serviceBody(box, id))).then(function () { saved(id ? 'セッションを保存しました。' : 'セッションを足しました。'); }).catch(function (x) { fail(box, box.querySelector('[data-msg]'), x); });
      };
      var sendCo = function (btn, box, body) {
        busy(btn, api('course', body)).then(function () { saved(body.id ? 'コースを保存しました。' : 'コースを足しました。'); }).catch(function (x) { fail(box, box.querySelector('[data-msg]'), x); });
      };
      M.querySelectorAll('[data-save-service]').forEach(function (b) { var id = b.getAttribute('data-save-service'); b.onclick = function () { sendSv(b, document.getElementById('sv-' + id), id); }; });
      M.querySelectorAll('[data-save-course]').forEach(function (b) { var id = b.getAttribute('data-save-course'), box = document.getElementById('co-' + id); b.onclick = function () { var body = courseBody(box); body.id = id; sendCo(b, box, body); }; });
      M.querySelectorAll('[data-add-course]').forEach(function (b) { var sid = b.getAttribute('data-add-course'), box = document.getElementById('nc-' + sid); b.onclick = function () { var body = courseBody(box); body.serviceId = sid; sendCo(b, box, body); }; });
      var ab = document.getElementById('addService');
      ab.onclick = function () { sendSv(ab, document.getElementById('nsCard'), null); };
    }).catch(function (x) { M.innerHTML = err(x); });
  }
  // セッション・コースの欄。同じ画面にいくつも並ぶので、欄の id は p（その行の印）を頭に付ける
  function serviceFields(s, p) {
    p = e(p);
    return '<div class="row g-2"><div class="col-12 col-sm-8">' + field('name', p + '-n', 'セッションの名前', true, input('name', p + '-n', s.name, 'data-k="name"')) + '</div><div class="col-6 col-sm-4">' + field('minutes', p + '-m', '長さ（分）', true, input('minutes', p + '-m', s.minutes, 'data-k="minutes" inputmode="numeric"')) + '</div>' +
      '<div class="col-12">' + field('surveyUrl', p + '-u', '事前アンケートの URL', false, input('surveyUrl', p + '-u', s.survey_url, 'data-k="surveyUrl" inputmode="url"'), '予約確認メールに入れます。') + '</div>' +
      '<div class="col-6 col-sm-4">' + field('sortOrder', p + '-o', '並び順', null, input('sortOrder', p + '-o', s.sort_order, 'data-k="sortOrder" inputmode="numeric"')) + '</div><div class="col-6 col-sm-8 d-flex align-items-end">' + check(p + '-v', '予約画面に出す', !!s.visible, 'data-k="visible"') + '</div></div>';
  }
  function courseFields(c, p) {
    p = e(p);
    return '<div class="row g-2"><div class="col-12 col-sm-8">' + field('name', p + '-n', 'コースの名前', true, input('name', p + '-n', c.name, 'data-k="name"')) + '</div><div class="col-6 col-sm-4">' + field('price', p + '-p', '料金（税込・円）', true, input('price', p + '-p', c.price, 'data-k="price" inputmode="numeric"')) + '</div>' +
      '<div class="col-12">' + field('description', p + '-d', '説明', false, '<textarea class="form-control" id="' + p + '-d" data-fk="description" data-k="description" rows="2">' + e(c.description) + '</textarea>') + '</div>' +
      '<div class="col-6 col-sm-4">' + field('sortOrder', p + '-o', '並び順', null, input('sortOrder', p + '-o', c.sort_order, 'data-k="sortOrder" inputmode="numeric"')) + '</div><div class="col-6 col-sm-8 d-flex align-items-end">' + check(p + '-v', '予約画面に出す', !!c.visible, 'data-k="visible"') + '</div></div>';
  }
  function grab(box) {
    var o = {};
    box.querySelectorAll('[data-k]').forEach(function (el) {
      // コースの行の中に、ほかの行の欄は無い（セッションの欄は card-body の中だけ）
      o[el.getAttribute('data-k')] = el.type === 'checkbox' ? el.checked : el.value;
    });
    return o;
  }
  function serviceBody(box, id) { var o = grab(box); var b = { name: o.name, minutes: Number(o.minutes), surveyUrl: o.surveyUrl, sortOrder: Number(o.sortOrder) || 0, visible: o.visible }; if (id) b.id = id; return b; }
  function courseBody(box) { var o = grab(box); return { name: o.name, price: o.price.trim(), description: o.description, sortOrder: Number(o.sortOrder) || 0, visible: o.visible }; }

  // ----- 名前 -----
  function me() {
    M.innerHTML = '<h1>画面に出す名前</h1><div class="card card-body shadow-sm" id="meCard"><p class="text-secondary small">' + e(INFO.email) + ' でログイン中</p>' + field('name', 'nm', '名前', true, input('name', 'nm', INFO.name)) +
      '<div id="mm"></div><p class="mb-2"><button class="btn btn-primary" id="sv">保存する</button> <a class="btn btn-outline-secondary" href="/admin/logout">ログアウト</a></p><p class="text-secondary small mb-0">変更履歴の「だれが」に出る名前です。</p></div>';
    var b = document.getElementById('sv');
    b.onclick = function () {
      var box = document.getElementById('meCard'), out = document.getElementById('mm');
      out.innerHTML = '';
      busy(b, api('me', { name: val('nm') })).then(function (j) { INFO = j.me; document.getElementById('me').textContent = j.me.name; out.innerHTML = okBox('保存しました。'); })
        .catch(function (x) { fail(box, out, x); });
    };
  }

  api('me').then(function (j) { INFO = j.me; document.getElementById('me').textContent = j.me.name; route(); }).catch(function (x) { M.innerHTML = err(x); });
})();
`;
