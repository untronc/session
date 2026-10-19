// 画面の色と、Bootstrap に重ねる見た目（予約画面と管理画面で共用）。基本設計書 追補（2026-10-13）S-01〜03
// 見本は宿泊の予約システムの画面の見本の「Bootstrap 版・色5（朱・減らした版）・予約画面はアプリ風」。
// 色の決まり：主の色1つ＋灰＋白だけ。3つの色は主の色だけが違い、灰と白は同じ。エラー・注意も主の色で出す
// 色は <html data-theme="shu|green|blue"> で切り替える（3つとも CSS に入れておき、設定を変えたら属性を替えるだけですぐ効く）
// 文字と地の差は WCAG AA の 4.5:1 以上（e2e/looks.mjs で確かめる）。白地の文字・リンクには p-text・link を使う（青は標準の #0d6efd だと白より明るい地で 4.5 に届かないので濃い方）

export const THEME_KEYS = ["shu", "green", "blue"]; // src/fields.js の theme の選択肢と同じ並び
export const DEFAULT_THEME = "shu";
export const THEMES = {
  // 朱：文字・ボタン #BA4A25、飾り #D35D35（紙芝居の色5）
  shu: { label: "朱", note: "既定", p: "#D35D35", solid: "#BA4A25", hover: "#9C3E1E", active: "#833319", rgb: "186,74,37", sub: "#FBE6DE", subBd: "#F0C0AE", text: "#A8421F", link: "#BA4A25", linkHover: "#9C3E1E", linkRgb: "186,74,37", err: "#BA4A25", errBg: "#FFF4EF" },
  // 緑：#183D43（宿のサイトの濃い緑）
  green: { label: "緑", note: "", p: "#183D43", solid: "#183D43", hover: "#0F2A2F", active: "#0B2024", rgb: "24,61,67", sub: "#E2ECEB", subBd: "#A8C3C3", text: "#183D43", link: "#183D43", linkHover: "#0F2A2F", linkRgb: "24,61,67", err: "#183D43", errBg: "#EEF4F4" },
  // 青：Bootstrap 標準の primary #0d6efd。白地以外の文字は #0a58ca
  blue: { label: "青", note: "Bootstrap 標準", p: "#0d6efd", solid: "#0d6efd", hover: "#0b5ed7", active: "#0a58ca", rgb: "13,110,253", sub: "#cfe2ff", subBd: "#9ec5fe", text: "#0a58ca", link: "#0a58ca", linkHover: "#084298", linkRgb: "10,88,202", err: "#0a58ca", errBg: "#EEF4FF" },
};
export const themeOf = (v) => (THEME_KEYS.includes(v) ? v : DEFAULT_THEME);

const svg = (s) => `url("data:image/svg+xml,${encodeURIComponent(s)}")`;

/** 色ごとの変数（主の色だけ）＋ 灰・白 ＋ Bootstrap の変数への当てはめ */
function varsCss() {
  const per = THEME_KEYS.map((k) => {
    const t = THEMES[k];
    return `html[data-theme="${k}"]{--p:${t.p};--p-solid:${t.solid};--p-hover:${t.hover};--p-active:${t.active};--p-rgb:${t.rgb};--p-sub:${t.sub};--p-sub-bd:${t.subBd};--p-text:${t.text};--link:${t.link};--link-hover:${t.linkHover};--link-rgb:${t.linkRgb};--err:${t.err};--err-bg:${t.errBg};` +
      `--invalid-icon:${svg(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12' width='12' height='12' fill='none' stroke='${t.err}'><circle cx='6' cy='6' r='4.5'/><path stroke-linejoin='round' d='M5.8 3.6h.4L6 6.5z'/><circle cx='6' cy='8.2' r='.6' fill='${t.err}' stroke='none'/></svg>`)}}`;
  }).join("\n");
  return `${per}
html[data-theme]{
  --ink:#2F2F2F;--ink-rgb:47,47,47;--mid:#666666;--mid-rgb:102,102,102;--line:#DCDCDC;--bg:#FAF8F4;--bg-rgb:250,248,244;--cap:#F3F3F3;--opt-bg:#EBEBEB;--opt-fg:#4D4D4D;--os:#5E5E5E;--os-rgb:94,94,94;
  --bs-body-font-family:"Noto Sans JP","Hiragino Sans","Yu Gothic UI","Yu Gothic",Meiryo,system-ui,sans-serif;
  --bs-body-color:var(--ink);--bs-body-color-rgb:var(--ink-rgb);--bs-body-bg:var(--bg);--bs-body-bg-rgb:var(--bg-rgb);
  --bs-border-color:var(--line);--bs-secondary-color:var(--mid);--bs-secondary-color-rgb:var(--mid-rgb);
  --bs-link-color:var(--link);--bs-link-color-rgb:var(--link-rgb);--bs-link-hover-color:var(--link-hover);--bs-link-hover-color-rgb:var(--link-rgb);
  --bs-primary:var(--p-solid);--bs-primary-rgb:var(--p-rgb);--bs-primary-bg-subtle:var(--p-sub);--bs-primary-border-subtle:var(--p-sub-bd);--bs-primary-text-emphasis:var(--p-text);
  --bs-danger:var(--err);--bs-danger-rgb:var(--p-rgb);--bs-danger-bg-subtle:var(--err-bg);--bs-danger-border-subtle:var(--err);--bs-danger-text-emphasis:var(--err);
  --bs-form-invalid-color:var(--err);--bs-form-invalid-border-color:var(--err);
  --bs-success:var(--p-solid);--bs-success-rgb:var(--p-rgb);--bs-secondary:#666666;--bs-secondary-rgb:102,102,102;
  --bs-info:#666666;--bs-info-rgb:102,102,102;--bs-warning:#666666;--bs-warning-rgb:102,102,102;
  --bs-light-rgb:245,245,245;--bs-dark:#2F2F2F;--bs-dark-rgb:47,47,47;
  --bs-tertiary-bg:#F6F6F6;--bs-tertiary-bg-rgb:246,246,246;--bs-secondary-bg:#ECECEC;--bs-secondary-bg-rgb:236,236,236;
  --bs-success-bg-subtle:#F1F1F1;--bs-success-border-subtle:#D0D0D0;--bs-success-text-emphasis:#2F2F2F;
  --bs-info-bg-subtle:#F1F1F1;--bs-info-border-subtle:#D0D0D0;--bs-info-text-emphasis:#2F2F2F;
  --bs-warning-bg-subtle:#F1F1F1;--bs-warning-border-subtle:#D0D0D0;--bs-warning-text-emphasis:#2F2F2F;
  --bs-body-font-size:.9375rem;
}`;
}

/** 予約画面と管理画面の両方で使う、Bootstrap の部品の見た目 */
const COMMON = `
body{line-height:1.6}
.btn{font-weight:600}
.btn-primary{--bs-btn-color:#fff;--bs-btn-bg:var(--p-solid);--bs-btn-border-color:var(--p-solid);--bs-btn-hover-color:#fff;--bs-btn-hover-bg:var(--p-hover);--bs-btn-hover-border-color:var(--p-hover);--bs-btn-active-color:#fff;--bs-btn-active-bg:var(--p-active);--bs-btn-active-border-color:var(--p-active);--bs-btn-focus-shadow-rgb:var(--p-rgb);--bs-btn-disabled-color:#fff;--bs-btn-disabled-bg:var(--p-solid);--bs-btn-disabled-border-color:var(--p-solid)}
.btn-outline-primary{--bs-btn-color:var(--p-text);--bs-btn-border-color:var(--p-solid);--bs-btn-hover-color:#fff;--bs-btn-hover-bg:var(--p-solid);--bs-btn-hover-border-color:var(--p-solid);--bs-btn-active-color:#fff;--bs-btn-active-bg:var(--p-active);--bs-btn-active-border-color:var(--p-active);--bs-btn-focus-shadow-rgb:var(--p-rgb);--bs-btn-disabled-color:var(--p-text);--bs-btn-disabled-border-color:var(--p-solid)}
.btn-outline-secondary{--bs-btn-color:var(--os);--bs-btn-border-color:var(--os);--bs-btn-hover-color:#fff;--bs-btn-hover-bg:var(--os);--bs-btn-hover-border-color:var(--os);--bs-btn-active-color:#fff;--bs-btn-active-bg:var(--os);--bs-btn-active-border-color:var(--os);--bs-btn-focus-shadow-rgb:var(--os-rgb)}
.btn-outline-danger{--bs-btn-color:var(--err);--bs-btn-border-color:var(--err);--bs-btn-hover-color:#fff;--bs-btn-hover-bg:var(--p-solid);--bs-btn-hover-border-color:var(--p-solid);--bs-btn-active-color:#fff;--bs-btn-active-bg:var(--p-active);--bs-btn-active-border-color:var(--p-active);--bs-btn-focus-shadow-rgb:var(--p-rgb)}
.btn-danger{--bs-btn-color:#fff;--bs-btn-bg:var(--p-solid);--bs-btn-border-color:var(--p-solid);--bs-btn-hover-color:#fff;--bs-btn-hover-bg:var(--p-hover);--bs-btn-hover-border-color:var(--p-hover);--bs-btn-active-color:#fff;--bs-btn-active-bg:var(--p-active);--bs-btn-active-border-color:var(--p-active);--bs-btn-focus-shadow-rgb:var(--p-rgb)}
.text-bg-success{background-color:var(--p-sub)!important;color:var(--p-text)!important}
.text-bg-info{background-color:#fff!important;color:var(--p-text)!important;box-shadow:inset 0 0 0 1px var(--p-solid)}
.text-bg-secondary{background-color:#666666!important;color:#fff!important}
.text-bg-light{background-color:#F5F5F5!important;color:var(--ink)!important}
.text-danger{color:var(--err)!important}
.form-control,.form-select{border-color:var(--line);color:var(--ink)}
.form-control:focus,.form-select:focus{border-color:var(--p);box-shadow:0 0 0 .2rem rgba(var(--p-rgb),.25)}
.form-control.is-invalid,.form-select.is-invalid{border-color:var(--err)}
.form-control.is-invalid{background-image:var(--invalid-icon)}
.form-control.is-invalid:focus,.form-select.is-invalid:focus{border-color:var(--err);box-shadow:0 0 0 .2rem rgba(var(--p-rgb),.25)}
.form-select{--bs-form-select-bg-img:${svg("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><path fill='none' stroke='#2F2F2F' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='m2 5 6 6 6-6'/></svg>")}}
.form-check-input:checked{background-color:var(--p-solid);border-color:var(--p-solid)}
.form-check-input:focus{border-color:var(--p);box-shadow:0 0 0 .2rem rgba(var(--p-rgb),.25)}
.form-label{font-weight:600;font-size:.875rem;color:var(--ink)}
.form-text{font-size:.8125rem;color:var(--mid)}
.invalid-feedback{font-size:.8125rem;color:var(--err)}
.invalid-feedback:not(:empty){display:block}
.req{display:inline-block;font-size:.6875rem;font-weight:700;background:var(--p-solid);color:#fff;border-radius:.25rem;padding:.05rem .4rem;margin-left:.4rem;vertical-align:.1em}
.opt{display:inline-block;font-size:.6875rem;font-weight:600;background:var(--opt-bg);color:var(--opt-fg);border-radius:.25rem;padding:.05rem .4rem;margin-left:.4rem;vertical-align:.1em}
.alert-success,.alert-info,.alert-warning,.alert-light{--bs-alert-color:#2F2F2F;--bs-alert-bg:#F1F1F1;--bs-alert-border-color:#CFCFCF}
.alert-danger{--bs-alert-color:var(--err);--bs-alert-bg:var(--err-bg);--bs-alert-border-color:var(--err)}
.card{--bs-card-border-color:var(--line);--bs-card-cap-bg:var(--cap);--bs-card-cap-padding-y:.6rem}
.card-header{font-size:.9375rem;color:var(--ink)}
.card-header .bi{color:var(--p)}
.list-group{--bs-list-group-border-color:var(--line)}
.text-secondary{color:var(--mid)!important}
`;

/** 管理画面だけの見た目（紙芝居の管理画面 7画面） */
const ADMIN = `
body{background:var(--bg)}
.adm-nav{position:sticky;top:0;z-index:1030;background:#fff;border-bottom:1px solid var(--line);--bs-navbar-padding-y:.4rem;--bs-navbar-color:var(--ink);--bs-navbar-hover-color:var(--p-text);--bs-navbar-active-color:var(--p-text);--bs-navbar-brand-color:var(--ink);--bs-navbar-brand-hover-color:var(--ink);--bs-navbar-toggler-border-color:rgba(0,0,0,.3);--bs-navbar-toggler-icon-bg:${svg("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 30 30'><path stroke='#2F2F2F' stroke-linecap='round' stroke-miterlimit='10' stroke-width='2' d='M4 7h22M4 15h22M4 23h22'/></svg>")}}
.adm-nav-in{max-width:960px}
.adm-nav .navbar-brand{font-size:1rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:calc(100% - 64px);margin-right:1.5rem}
.adm-nav .navbar-toggler{border-color:rgba(0,0,0,.3);padding:.25rem .5rem}
.adm-nav .nav-link{border-radius:.375rem;padding:.6rem .85rem;font-size:.95rem}
.adm-nav .nav-link .bi{margin-right:.35rem}
.adm-nav .nav-link.active{box-shadow:inset 3px 0 0 var(--p-solid)}
@media (min-width:768px){.adm-nav{--bs-navbar-padding-y:0}.adm-nav .navbar-nav{gap:.5rem}.adm-nav .nav-link{padding:1rem 1rem}.adm-nav .nav-link.active{box-shadow:inset 0 -3px 0 var(--p-solid);border-radius:0}}
.adm-main{max-width:720px;margin:0 auto;padding:12px 12px 80px}
.adm-main h1{font-size:1.2rem;margin:8px 0 12px}
.adm-main h2{font-size:.9375rem;margin:20px 0 8px;color:var(--ink);font-weight:700}
.bs-k{font-size:.8125rem;color:var(--mid)}
@media (min-width:576px){.bs-k{flex:0 0 7.5em}}
.bs-v{min-width:0;word-break:break-word;white-space:pre-wrap}
.bs-price .bs-total{font-size:1.75rem;font-weight:700;color:var(--p-text);line-height:1.2}
.bs-price .bs-row{display:flex;justify-content:space-between;gap:.5rem;font-size:.875rem}
.heat-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:3px}
.heat-grid .w{font-size:.75rem;text-align:center;color:var(--mid)}
.heat{display:block;min-height:58px;border:1px solid var(--line);border-radius:.375rem;padding:3px;text-decoration:none;color:var(--ink);font-size:.75rem;line-height:1.35;overflow:hidden;background:#fff}
.heat:hover{filter:brightness(.96);color:var(--ink)}
.heat b{font-size:.875rem}
.heat .n{display:block;font-weight:700;white-space:nowrap}
.heat .s{display:block}
.heat-1{background:var(--p-sub)}
.heat-f{background:var(--p-solid);color:#fff;border:2px solid var(--p-solid);padding:2px}
.heat-f:hover{color:#fff}
.heat-s{background:#EFEFEF;color:var(--ink)}
.heat.today{box-shadow:0 0 0 2px #fff,0 0 0 4px var(--p)}
.sw{display:inline-block;width:1.1rem;height:1.1rem;border-radius:.25rem;border:1px solid var(--line);vertical-align:-.2em;margin-right:.3rem}
.timeline{position:relative;padding:.75rem 1rem .25rem 1rem;margin:0;list-style:none}
.timeline::before{content:"";position:absolute;left:calc(1rem + 13px);top:1.6rem;bottom:1.6rem;width:2px;background:var(--line)}
.tl-item{position:relative;display:flex;gap:.75rem;padding-bottom:1rem}
.tl-dot{flex:none;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.8rem;z-index:1;background:#fff;color:var(--p-text);border:2px solid var(--p)}
.tl-item .tl-body{min-width:0;flex:1}
.tl-item .tl-detail{font-size:.8125rem;color:var(--mid);white-space:pre-wrap;word-break:break-word}
.hist{font-size:14px;border-left:3px solid var(--line);padding:.5rem .5rem .5rem 8px;margin:6px 0;background:#fff;border-radius:0 .375rem .375rem 0}
.card.border-danger{border-color:#A8A8A8!important}
.table{--bs-table-striped-bg:var(--cap);font-size:.875rem;white-space:nowrap}
.table td:not(:first-child),.table th:not(:first-child){text-align:right}
.table-primary{--bs-table-bg:var(--p-sub);--bs-table-color:var(--p-text);--bs-table-border-color:var(--p-sub-bd)}
.bs-bars .progress{height:1.4rem;--bs-progress-bar-bg:var(--p-solid);--bs-progress-bg:var(--cap)}.bs-bars .progress-stacked{height:1.4rem;background:var(--cap)}.bs-bars .progress-stacked>.progress{--bs-progress-bg:transparent}
.bs-bars .bar-label{flex:0 0 5.2em;font-size:.8125rem}
.theme-opt{display:flex;align-items:center;gap:.75rem;padding:.75rem;border:1px solid var(--line);border-radius:.5rem;background:#fff;cursor:pointer;margin:0 0 .5rem}
.theme-opt:has(input:checked){border-color:var(--p-solid);box-shadow:0 0 0 1px var(--p-solid)}
.theme-opt input{margin:0;flex:none}
.theme-sw{display:inline-flex;gap:3px;flex:none}
.theme-sw i{display:block;width:22px;height:22px;border-radius:.3rem;border:1px solid rgba(0,0,0,.15)}
`;

/** 予約画面（アプリ風）だけの見た目。埋め込みの枠（iframe）の中では、上の帯と下のボタンを固定しない（html.ybk-framed） */
const EMBED = `
html,body{margin:0}
body{background:#E6E6E6;background:color-mix(in srgb,var(--cap),#000 7%)}
html.ybk-framed body{background:transparent}
#ybk{max-width:480px;margin:0 auto;padding:0 16px calc(170px + env(safe-area-inset-bottom));background:var(--cap);min-height:100vh;font-size:15px;line-height:1.6;color:var(--ink);box-shadow:0 0 0 1px rgba(0,0,0,.05),0 8px 32px rgba(0,0,0,.08);scroll-margin-top:100px}
html.ybk-framed #ybk{min-height:0;padding-bottom:16px;box-shadow:none;border-radius:12px}
#ybk *{box-sizing:border-box}
#ybk[data-loading]{visibility:hidden}
.app-top{position:sticky;top:0;z-index:1020;margin:0 -16px 16px;background:#fff;box-shadow:0 1px 0 rgba(0,0,0,.05)}
html.ybk-framed .app-top{position:static;border-radius:12px 12px 0 0}
.app-top-row{display:grid;grid-template-columns:52px minmax(0,1fr) 52px;align-items:center;height:48px}
.app-back{display:flex;align-items:center;justify-content:center;width:44px;height:44px;margin-left:4px;border-radius:50%;font-size:30px;line-height:1;color:var(--ink);background:transparent;border:0;padding:0 0 3px;cursor:pointer}
.app-back:hover{background:var(--cap)}
.app-title{text-align:center;font-weight:700;font-size:15px;margin:0}
.app-prog{display:grid;grid-template-columns:repeat(4,1fr);gap:2px}
.app-prog i{display:block;height:3px;background:var(--opt-bg)}
.app-prog i.on{background:var(--p-solid)}
.app-lead{color:var(--mid);font-size:14px;margin:0 2px 12px}
.app-card{background:#fff;border-radius:16px;padding:16px;margin:0 0 12px}
.app-sub{font-size:13px;color:var(--mid)}
.app-strong{font-weight:700;font-size:16px}
.app-change{display:inline-flex;align-items:center;min-height:44px;margin:-10px -6px;padding:0 6px;font-size:14px;font-weight:600;color:var(--link);text-decoration:none;white-space:nowrap;background:transparent;border:0;cursor:pointer}
.app-stay{display:flex;justify-content:space-between;align-items:center;gap:12px}
.app-cal-card{background:#fff;border-radius:16px;padding:8px 8px 6px;margin:0 0 8px}
.ybk-cal-head{display:flex;align-items:center;justify-content:space-between;margin:4px 2px 2px}
.ybk-month{font-size:17px;font-weight:700}
.ybk-nav{width:44px;height:44px;border-radius:50%;border:0;background:var(--cap);color:var(--ink);font-size:26px;line-height:1;display:flex;align-items:center;justify-content:center;padding:0 0 3px;cursor:pointer}
.ybk-nav:hover{background:var(--opt-bg)}
.ybk-cal{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:0 2px;min-height:396px;align-content:start}
.ybk-cal .w{font-size:12px;text-align:center;color:var(--mid);padding:6px 0 4px}
.ybk-cal .ybk-wait{grid-column:1/-1;text-align:center;color:var(--mid);font-size:14px;padding:24px 0}
.app-day{appearance:none;border:0;background:transparent;padding:0;margin:0;display:flex;flex-direction:column;align-items:center;gap:1px;min-height:62px;min-width:0;color:var(--ink);font:inherit;cursor:pointer}
.app-day .dn{display:flex;align-items:center;justify-content:center;width:min(44px,100%);aspect-ratio:1;border-radius:50%;font-size:16px;font-weight:600;line-height:1}
.app-day .dk{height:14px;display:flex;align-items:center;justify-content:center;font-size:10.5px;font-weight:700;line-height:1;color:var(--p-text);white-space:nowrap}
.app-day .dk i,.app-legend i{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--p-solid)}
.app-day:hover:not(:disabled) .dn{background:var(--cap)}
.app-day.sel .dn,.app-day.sel:hover .dn{background:var(--p-solid);color:#fff}
.app-day:disabled{cursor:default}
.app-day:disabled .dn{color:var(--mid);opacity:.4}
.app-day:focus-visible{outline:none}
.app-day:focus-visible .dn{box-shadow:0 0 0 3px rgba(var(--p-rgb),.35)}
.app-legend{font-size:12px;color:var(--mid);margin:2px 6px 14px;display:flex;flex-wrap:wrap;align-items:center;gap:2px 14px}
.app-legend b{color:var(--p-text);font-weight:700}
.app-row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:52px}
.app-row + .app-row{border-top:1px solid var(--cap)}
.app-k{color:var(--mid);font-size:14px}
.app-row > b{font-size:16px}
.app-stepper{display:flex;align-items:center;gap:4px}
.app-sb{width:44px;height:44px;border-radius:50%;border:0;background:var(--cap);color:var(--ink);font-size:24px;line-height:1;display:flex;align-items:center;justify-content:center;padding:0 0 2px;cursor:pointer}
.app-sb:not(:disabled):active{background:var(--opt-bg)}
.app-sb:disabled{opacity:.35;cursor:default}
.app-sb:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(var(--p-rgb),.35)}
.app-sv{min-width:4.6em;text-align:center;font-size:18px;font-weight:700;font-variant-numeric:tabular-nums}
.app-card .invalid-feedback{margin:0 0 6px;text-align:right}
.app-form{background:#fff;border-radius:16px;padding:16px 16px 2px;margin:0 0 12px}
.ybk-f{margin-bottom:16px;display:flex;flex-direction:column}
#ybk .form-label{font-size:13.5px;font-weight:600;margin-bottom:6px}
#ybk .form-control,#ybk .form-select{min-height:48px;font-size:16px;border-radius:12px;background-color:var(--cap);border:1px solid transparent;padding:.65rem .9rem}
#ybk .form-select{padding-right:2.25rem}
#ybk textarea.form-control{min-height:96px}
#ybk .form-control:focus,#ybk .form-select:focus{background-color:#fff;border-color:var(--p-solid);box-shadow:0 0 0 3px rgba(var(--p-rgb),.2)}
#ybk .form-control.is-invalid,#ybk .form-select.is-invalid{background-color:#fff;border-color:var(--err)}
#ybk .req{background:transparent;color:var(--p-text);padding:0;margin-left:.5rem;font-size:.6875rem;font-weight:600}
#ybk .opt{background:transparent;color:var(--mid);padding:0;margin-left:.5rem;font-size:.6875rem;font-weight:600}
#ybk .form-text{font-size:12.5px;margin-top:6px}
#ybk .is-invalid ~ .form-text{display:none}
#ybk .invalid-feedback{font-size:13px;font-weight:600;margin-top:6px}
.ybk-msg{margin:0 0 12px;font-size:14px}
.ybk-msg:empty{display:none}
.ybk-note{font-size:13px;color:var(--mid);padding:0 4px;margin:0 0 12px}
.ybk-agree{display:flex;background:#fff;border-radius:16px;padding:14px 16px;margin:0 0 8px;gap:12px;align-items:center;font-size:14px;line-height:1.5;cursor:pointer}
.ybk-agree input{width:1.5rem;height:1.5rem;margin:0;flex:none}
.ybk-agree a{color:var(--link);text-decoration:underline}
.ybk-agree + .invalid-feedback{margin:-2px 4px 10px}
.app-confirm{padding:2px 16px}
.app-sec{padding:14px 0}
.app-sec + .app-sec{border-top:1px solid var(--cap)}
.app-sec-h{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--mid);margin-bottom:4px}
.app-dl{display:grid;grid-template-columns:6.2em minmax(0,1fr);gap:6px 8px;margin:0;font-size:14.5px}
.app-dl dt{color:var(--mid);font-weight:400;font-size:13px;padding-top:1px}
.app-dl dd{margin:0;word-break:break-word;white-space:pre-wrap}
.app-price{background:var(--cap);border-radius:12px;padding:14px!important;margin:2px 0 14px;border-top:0!important}
.app-prow{display:flex;justify-content:space-between;gap:8px;font-size:14px}
.app-pay{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-top:8px;padding-top:8px;border-top:1px solid var(--opt-bg);font-weight:700}
.app-pay b{font-size:24px;line-height:1.2;color:var(--p-text)}
.app-done-mark{width:84px;height:84px;border-radius:50%;background:var(--p-solid);color:#fff;display:flex;align-items:center;justify-content:center;margin:20px auto 16px}
.ybk-h{font-size:20px;font-weight:700;text-align:center;margin:0 0 16px}
.app-no{font-size:30px;font-weight:700;letter-spacing:.06em;font-variant-numeric:tabular-nums;line-height:1.3}
.app-h4{font-size:15px;font-weight:700;margin:0 0 4px}
.app-todo{list-style:none;margin:12px 0 0;padding:0;display:grid;gap:16px;counter-reset:t}
.app-todo li{display:grid;grid-template-columns:28px minmax(0,1fr);gap:12px;align-items:start;counter-increment:t}
.app-todo li::before{content:counter(t);width:28px;height:28px;border-radius:50%;background:var(--p-sub);color:var(--p-text);font-weight:700;font-size:13px;display:flex;align-items:center;justify-content:center}
.app-todo b{display:block;font-size:15px}
.app-todo span{display:block;font-size:13.5px;color:var(--mid)}
.app-cta{position:fixed;left:0;right:0;bottom:0;margin:0 auto;max-width:480px;z-index:1030;background:#fff;padding:10px 16px calc(12px + env(safe-area-inset-bottom));box-shadow:0 -1px 0 rgba(0,0,0,.06),0 -8px 24px rgba(0,0,0,.06)}
html.ybk-framed .app-cta{position:static;margin:4px 0 0;padding:0;max-width:none;background:transparent;box-shadow:none}  /* 枠の中では下の帯にしない（中身のすぐ下に合計とボタン）。*/
.app-total{display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-size:13px;color:var(--mid);margin-bottom:8px}
.app-total b{font-size:18px;color:var(--ink)}
.app-cta-btn{display:flex;align-items:center;justify-content:center;width:100%;min-height:54px;border-radius:14px;font-size:16px;font-weight:700}
`;

/** 管理画面の CSS（Bootstrap のあとに読む） */
export const adminCss = () => varsCss() + COMMON + ADMIN;
/** 予約画面の CSS（Bootstrap のあとに読む） */
export const embedCss = () => varsCss() + COMMON + EMBED;
