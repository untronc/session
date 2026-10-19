// 予約画面（お客様）。紙芝居の形：コース → 日時 → お客さまの情報 → 確認 → 仮のご予約。スマホ・下に固定のボタン・untronc の緑
// 同じ住所の /api を呼ぶ。文字は textContent で入れる（お客様の入力を HTML として扱わない）
import { PAGE_CSS } from "./page-style.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const top = (n, title, back) =>
  `<div class="app-top"><div class="app-top-row">${back ? `<button class="app-back" data-go="${back}" aria-label="戻る">‹</button>` : "<span></span>"}<h2 class="app-title">${title}</h2><span></span></div><div class="app-prog">${[1, 2, 3, 4].map((i) => `<i${i <= n ? ' class="on"' : ""}></i>`).join("")}</div></div>`;

export function bookingPage(site) {
  const cfg = { privacyUrl: site.privacyUrl, showcase: site.showcase, name: site.name };
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>ご予約｜${esc(site.name)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;600;700&display=swap" rel="stylesheet">
<style>${PAGE_CSS}</style>
</head>
<body>
<div id="app">
  <section class="step on" data-step="1">
    ${top(1, "コースを選ぶ")}
    <div class="alert" data-msg="1"></div>
    <div id="courses"><p class="wait">読み込み中…</p></div>
    <div class="cta"><div class="total" id="course-sum"></div><button class="cta-btn" id="to2" disabled>次へ　日時を選ぶ</button></div>
  </section>

  <section class="step" data-step="2">
    ${top(2, "日時を選ぶ", 1)}
    <div class="alert" data-msg="2"></div>
    <p class="app-lead">点のある日に、空いている時間があります。</p>
    <div class="app-cal-card">
      <div class="cal-head"><button class="nav" id="prev" aria-label="前の月">‹</button><span class="cal-month" id="month"></span><button class="nav" id="next" aria-label="次の月">›</button></div>
      <div class="cal" id="cal"></div>
    </div>
    <div class="app-legend"><span><i></i>空きあり</span><span>薄い日は選べません</span></div>
    <p class="times-h" id="times-h"></p>
    <div class="times" id="times"></div>
    <div class="cta"><div class="total" id="sel-time"></div><button class="cta-btn" id="to3" disabled>次へ　お客さまの情報</button></div>
  </section>

  <section class="step" data-step="3">
    ${top(3, "お客さまの情報", 2)}
    <div class="sum"><div><span class="k" data-course-line></span><b data-when></b></div><button class="change" data-go="2">変更</button></div>
    <div class="app-form">
      <div class="f"><label for="n">お名前<span class="req">必須</span></label><input id="n" autocomplete="name" maxlength="50"><div class="err" data-err="name"></div></div>
      <div class="f"><label for="g">Google アカウントのメールアドレス<span class="req">必須</span></label><input id="g" type="email" autocomplete="email" inputmode="email"><div class="hint">セッションで使う Google のアドレス（Gmail）をお書きください。</div><div class="err" data-err="googleEmail"></div></div>
      <div class="f"><label for="c">連絡用のメールアドレス<span class="opt">任意</span></label><input id="c" type="email" inputmode="email"><div class="hint">ご予約の確認や振込先のメールを、上の Gmail とは別のアドレスで受け取りたいときだけ。空なら上の Gmail にお送りします。</div><div class="err" data-err="contactEmail"></div></div>
    </div>
    <div class="cta"><div class="total"></div><button class="cta-btn" id="to4">確認へ</button></div>
  </section>

  <section class="step" data-step="4">
    ${top(4, "内容の確認", 3)}
    <div class="alert" data-msg="4"></div>
    <p class="app-lead">内容をご確認のうえ、予約してください。</p>
    <div class="app-card app-confirm">
      <div class="sec"><div class="sec-h">ご予約<button class="change" data-go="2">変更</button></div>
        <dl class="dl"><dt>コース</dt><dd data-course-name></dd><dt>日時</dt><dd data-when></dd><dt>場所</dt><dd>Google Meet（URL は入金の確認後にメールで）</dd></dl></div>
      <div class="sec"><div class="sec-h">お客さま<button class="change" data-go="3">変更</button></div>
        <dl class="dl"><dt>お名前</dt><dd id="v-n"></dd><dt>Google</dt><dd id="v-g"></dd><dt>連絡用</dt><dd id="v-c"></dd></dl></div>
      <div class="sec price"><div class="pay"><span>お支払い</span><b data-price></b></div>
        <div class="pay-note">銀行振込（前払い）。期限は <b style="color:var(--ink)" data-due></b> まで（ご予約から1週間以内、かつセッションの前日まで）。振込先はこのあとの画面とメールでお知らせします。振込手数料はお客さまのご負担です。</div></div>
      <div class="sec"><div class="sec-h">キャンセル料（入金のあとのキャンセル）</div>
        <table class="cancel"><tr><td data-c0></td><td>0%（全額お返し）</td></tr><tr><td data-c1></td><td>50%</td></tr><tr><td data-c2></td><td>100%</td></tr></table>
        <div class="pay-note">お返しする振込の手数料は差し引きます。日時の変更は1回まで無料です。</div></div>
    </div>
    <label class="agree"><input type="checkbox" id="agree"> <span>キャンセル料に同意します</span></label>
    <div class="err" data-err="agree" style="margin:-4px 8px 8px"></div>
    <label class="agree"><input type="checkbox" id="privacy"> <span><a href="${esc(site.privacyUrl)}" target="_blank" rel="noopener">プライバシーポリシー</a>（海外の事業者のサービスへの個人情報の提供を含む）に同意します</span></label>
    <div class="err" data-err="privacyAgree" style="margin:-4px 8px 8px"></div>
    <div class="cta"><div class="total"><b data-price></b>・銀行振込</div><button class="cta-btn" id="book">予約する</button></div>
  </section>

  <section class="step" data-step="5">
    ${top(4, "仮のご予約")}
    <div class="done-mark"><svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
    <h3 class="h">仮のご予約を受け付けました。</h3>
    <div class="no-k">予約番号</div><div class="no" id="d-no"></div>
    <div class="app-card">
      <div style="font-weight:700;margin-bottom:2px" data-when></div>
      <div style="font-size:13.5px;color:var(--mid)"><span data-course-name></span>・Google Meet・<span data-price></span></div>
      <ol class="todo">
        <li><div><b><span id="d-due"></span>までにお振り込みください</b><span id="d-name-note"></span><div class="bank" id="d-bank"></div></div></li>
        <li><div><b>入金を確かめたら、ご予約が確定します</b><span id="d-mail-note"></span></div></li>
        <li><div><b>前日にもう一度お知らせします</b><span>日時と Google Meet の URL をメールでお送りします。</span></div></li>
      </ol>
    </div>
    <p class="made"><span id="d-showcase"></span><br><a id="d-showcase-link" target="_blank" rel="noopener"></a></p>
  </section>
</div>
<script>
(function () {
  var CFG = ${JSON.stringify(cfg).replace(/</g, "\\u003c")};
  var W = '日月火水木金土'.split('');
  var st = { services: [], slots: [], course: null, service: null, day: null, slot: null, month: null };
  function q(s) { return document.querySelector(s); }
  function qa(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }
  function setAll(sel, text) { qa(sel).forEach(function (x) { x.textContent = text; }); }
  function yen(n) { return String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',') + '円'; }
  function pd(n) { return (n < 10 ? '0' : '') + n; }
  function dt(ymd) { var p = ymd.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function ymdOf(d) { return d.toISOString().slice(0, 10); }
  function md(ymd) { var d = dt(ymd); return (d.getUTCMonth() + 1) + '月' + d.getUTCDate() + '日(' + W[d.getUTCDay()] + ')'; }
  function addD(ymd, n) { return ymdOf(new Date(dt(ymd).getTime() + n * 86400000)); }
  function todayJst() { return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); }
  function when(s) { return md(s.start_at.slice(0, 10)) + ' ' + s.start_at.slice(11) + '〜' + s.end_at.slice(11); }
  function show(n) { qa('.step').forEach(function (el) { el.classList.toggle('on', el.getAttribute('data-step') === String(n)); }); window.scrollTo(0, 0); }
  function msg(n, text) { var el = q('[data-msg="' + n + '"]'); if (el) el.textContent = text || ''; }
  function errs(e) {
    qa('[data-err]').forEach(function (x) { x.textContent = (e && e[x.getAttribute('data-err')]) || ''; });
    ['n:name', 'g:googleEmail', 'c:contactEmail'].forEach(function (p) { var k = p.split(':'); q('#' + k[0]).classList.toggle('bad', !!(e && e[k[1]])); });
  }
  document.addEventListener('click', function (e) { var t = e.target.closest('[data-go]'); if (t) show(t.getAttribute('data-go')); });

  // 1 コース
  function drawCourses() {
    var box = q('#courses'); box.textContent = '';
    if (!st.services.length) { box.innerHTML = '<p class="wait">いまご予約を受けているセッションはありません。</p>'; return; }
    st.services.forEach(function (s) {
      var lead = document.createElement('p'); lead.className = 'app-lead'; lead.textContent = s.name + '。どちらかを選んでください。'; box.appendChild(lead);
      var chips = document.createElement('div'); chips.className = 'chips';
      [s.minutes + '分', 'Google Meet で1対1', '税込'].forEach(function (t) { var c = document.createElement('span'); c.className = 'chip'; c.textContent = t; chips.appendChild(c); });
      box.appendChild(chips);
      s.courses.forEach(function (c) {
        var el = document.createElement('div'); el.className = 'course'; el.setAttribute('role', 'radio'); el.tabIndex = 0;
        el.innerHTML = '<span class="dot"></span><div class="c-body"><div class="c-head"><b></b><span class="c-price"></span></div><div class="c-desc"></div></div>';
        el.querySelector('b').textContent = c.name; el.querySelector('.c-price').textContent = yen(c.price); el.querySelector('.c-desc').textContent = c.description || '';
        el.onclick = function () { st.course = c; st.service = s; qa('.course').forEach(function (x) { x.classList.toggle('sel', x === el); }); q('#course-sum').innerHTML = ''; var b = document.createElement('b'); b.textContent = c.name; q('#course-sum').appendChild(b); q('#course-sum').appendChild(document.createTextNode('・' + yen(c.price))); q('#to2').disabled = false; };
        box.appendChild(el);
      });
    });
  }
  q('#to2').onclick = function () { if (!st.course) return; drawCal(); show(2); };

  // 2 日時
  function days() { var m = {}; st.slots.forEach(function (s) { (m[s.start_at.slice(0, 10)] = m[s.start_at.slice(0, 10)] || []).push(s); }); return m; }
  function drawCal() {
    var byDay = days(), keys = Object.keys(byDay).sort();
    if (!st.month) st.month = (keys[0] || todayJst()).slice(0, 7);
    var y = +st.month.slice(0, 4), m = +st.month.slice(5, 7);
    q('#month').textContent = y + '年' + m + '月';
    var first = new Date(Date.UTC(y, m - 1, 1)), last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    var cal = q('#cal'); cal.textContent = '';
    W.forEach(function (w) { var s = document.createElement('span'); s.className = 'w'; s.textContent = w; cal.appendChild(s); });
    for (var i = 0; i < first.getUTCDay(); i++) cal.appendChild(document.createElement('span'));
    for (var d = 1; d <= last; d++) {
      var key = st.month + '-' + pd(d), ok = !!byDay[key];
      var b = document.createElement('button'); b.className = 'day' + (key === st.day ? ' sel' : ''); b.disabled = !ok; b.setAttribute('data-d', key);
      b.innerHTML = '<span class="dn">' + d + '</span><span class="dk">' + (ok ? '<i></i>' : '') + '</span>';
      cal.appendChild(b);
    }
    var ms = keys.map(function (k) { return k.slice(0, 7); });
    q('#prev').disabled = !ms.some(function (x) { return x < st.month; });
    q('#next').disabled = !ms.some(function (x) { return x > st.month; });
    drawTimes();
  }
  function shiftMonth(n) { var y = +st.month.slice(0, 4), m = +st.month.slice(5, 7) + n; if (m < 1) { y--; m = 12; } if (m > 12) { y++; m = 1; } st.month = y + '-' + pd(m); drawCal(); }
  q('#prev').onclick = function () { shiftMonth(-1); };
  q('#next').onclick = function () { shiftMonth(1); };
  q('#cal').onclick = function (e) { var b = e.target.closest('.day'); if (!b || b.disabled) return; st.day = b.getAttribute('data-d'); st.slot = null; drawCal(); };
  function drawTimes() {
    var list = (days()[st.day] || []), box = q('#times'); box.textContent = '';
    q('#times-h').textContent = st.day ? md(st.day) + 'の空いている時間' : '日にちを選んでください';
    list.forEach(function (s) {
      var b = document.createElement('button'); b.className = 'time' + (st.slot && st.slot.id === s.id ? ' sel' : '');
      b.textContent = s.start_at.slice(11); var sm = document.createElement('small'); sm.textContent = '〜' + s.end_at.slice(11); b.appendChild(sm);
      b.onclick = function () { st.slot = s; drawTimes(); };
      box.appendChild(b);
    });
    q('#sel-time').textContent = st.slot ? when(st.slot) : '';
    q('#to3').disabled = !st.slot;
  }
  q('#to3').onclick = function () { if (!st.slot) return; setAll('[data-when]', when(st.slot)); setAll('[data-course-line]', st.course.name + '・' + st.service.minutes + '分'); show(3); };

  // 3 お客さまの情報 → 4 確認
  q('#to4').onclick = function () {
    var e = {}, n = q('#n').value.trim(), g = q('#g').value.trim(), c = q('#c').value.trim(), re = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
    if (!n) e.name = 'お名前を入れてください';
    if (!g) e.googleEmail = 'Google アカウントのメールアドレスを入れてください'; else if (!re.test(g)) e.googleEmail = 'メールアドレスの形が正しくありません';
    if (c && !re.test(c)) e.contactEmail = 'メールアドレスの形が正しくありません';
    errs(e); if (Object.keys(e).length) return;
    q('#v-n').textContent = n; q('#v-g').textContent = g; q('#v-c').textContent = c || '（Google のアドレスへお送りします）';
    setAll('[data-course-name]', st.course.name); setAll('[data-price]', yen(st.course.price));
    // 振込の期限：予約の日＋7日とセッションの前日の早い方（サーバーと同じ決まり。確定の値はサーバーが返す）
    var day = st.slot.start_at.slice(0, 10), wk = addD(todayJst(), 7), eve = addD(day, -1);
    setAll('[data-due]', md(wk < eve ? wk : eve));
    q('[data-c0]').textContent = md(addD(day, -3)) + 'まで'; q('[data-c1]').textContent = md(addD(day, -2)) + '〜' + md(addD(day, -1)); q('[data-c2]').textContent = md(day) + ' 当日・ご連絡なし';
    msg(4, ''); show(4);
  };

  // 4 予約する → 5
  q('#book').onclick = function () {
    var btn = q('#book'); if (btn.disabled) return; btn.disabled = true; btn.textContent = '送っています…';
    var body = { action: 'book', courseId: st.course.id, slotId: st.slot.id, name: q('#n').value.trim(), googleEmail: q('#g').value.trim(), contactEmail: q('#c').value.trim(), agree: q('#agree').checked, privacyAgree: q('#privacy').checked };
    fetch('/api', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) }).then(function (r) { return r.json(); }).then(function (r) {
      btn.disabled = false; btn.textContent = '予約する';
      if (!r.ok) {
        errs(r.errors || {});
        if (r.errors && r.errors.slotId) { st.slot = null; return load().then(function () { msg(2, r.error); drawCal(); show(2); }); }
        if (r.errors && (r.errors.name || r.errors.googleEmail || r.errors.contactEmail)) { show(3); return; }
        msg(4, r.error || '送れませんでした。もう一度お試しください'); return;
      }
      q('#d-no').textContent = r.id; q('#d-due').textContent = md(r.due_date);
      q('#d-name-note').textContent = '振込の名義の前に、予約番号「' + r.id.replace('-', '') + '」を入れてください。';
      q('#d-bank').textContent = r.bank || '振込先の口座は、メールでお知らせします。';
      q('#d-mail-note').textContent = 'Google Meet の URL と事前アンケートの URL を、' + (body.contactEmail || body.googleEmail) + ' にお送りします。';
      q('#d-showcase').textContent = CFG.showcase.text; var a = q('#d-showcase-link'); a.href = CFG.showcase.url; a.textContent = '予約システムのご相談はこちら';
      show(5);
    }).catch(function () { btn.disabled = false; btn.textContent = '予約する'; msg(4, '通信が切れました。もう一度「予約する」を押してください'); });
  };

  function load() {
    return fetch('/api?action=slots').then(function (r) { return r.json(); }).then(function (r) {
      if (!r.ok) throw new Error(r.error);
      st.services = r.services; st.slots = r.slots;
    });
  }
  load().then(drawCourses).catch(function () { q('#courses').textContent = ''; msg(1, '空き状況を読み込めませんでした。時間をおいて開き直してください'); });
})();
</script>
</body>
</html>`;
}
