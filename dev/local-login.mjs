// 手元の確認だけに使う：手元の D1 に管理画面の利用者を1人入れたあと、その人のログインの Cookie の値を出す（Google を通さない）
//   node dev/local-login.mjs <sub>   （SESSION_SECRET は sites/<施設>/.dev.vars から読む。施設は環境変数 YOYAKU_SITE。無ければ名前が -test で終わる施設）
import { readdirSync, readFileSync } from "node:fs";
import { sign } from "../src/auth.js";

const secret = /SESSION_SECRET=(\S+)/.exec(readFileSync(new URL(`../sites/${process.env.YOYAKU_SITE || readdirSync(new URL("../sites", import.meta.url)).find((n) => n.endsWith("-test"))}/.dev.vars`, import.meta.url), "utf8"))[1];
console.log(encodeURIComponent(await sign(secret, { sub: process.argv[2] || "local-op", exp: Date.now() + 12 * 3600000 })));
