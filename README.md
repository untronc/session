# session

時間枠のセッション（オンライン・Google Meet）の予約のシステム。予約画面と、運用者が使う管理画面（Google でログイン）を、Cloudflare Workers と D1 で動かす。運用者の Google カレンダーで空きを見て、確定したら Meet の URL を付ける。支払いは銀行振込（運用者が入金を確かめて確定する）。

## 中身
- `src/`：仕組み（予約・空きの計算・キャンセル料と返金・管理画面・ログイン・Google カレンダー・メール・決まった時刻の処理）
- `migrations/`：D1 の表（`V0001__説明.sql` の形。SQLite・PostgreSQL・MySQL で同じ文が通る形で書く）
- `test/`：単体テスト（架空の設定 `test/site.fixture.js` で流す。Google カレンダーは偽物に差し替える）
- `dev/`：道具（`local-login.mjs`：手元の管理画面に入る。`put-secret.mjs`：秘密の値を Worker に入れる。`setup-google.mjs`：Google のクライアントのシークレット・カレンダーの許可・Resend の鍵を、運用者の画面の操作1回分で Worker に入れる）
- `public/`：Worker の静的ファイル。`public/vendor/` は npm で入れた Bootstrap 5.3.3・Bootstrap Icons を `dev/copy-vendor.mjs` が写した物（npm install のたびに自動。Git に入れない）
- `sites/<名前>/`：設定（運用者のメール・送り元・プライバシーポリシー・D1）。公開しない（`.gitignore`）

## 流し方
Node 22 以上。

```
npm install
npm run check     # 単体テスト
```

## 設定を足す
`sites/<名前>/` に `site.config.js`（`src/config.js` の項目）・`index.js`・`wrangler.jsonc`（`"assets": { "directory": "../../public" }` と、決まった時刻の処理 `"triggers": { "crons": ["0 15 * * *", "0 0 * * *"] }` を入れる）を置く。振込先の口座・前後の空ける時間・見るカレンダーは、運用者が管理画面の「設定」で入れる。

## ライセンス
PolyForm Noncommercial License 1.0.0（`LICENSE`）。商用の利用はできない。商用で使いたいときは untronc（https://untronc.jp ）へ。
