// 単体テスト。Cloudflare の実行環境（workerd）の中で流し、D1 は手元の写しを使う。メールと Google は偽物に差し替える
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        miniflare: {
          compatibilityDate: "2026-08-22",
          d1Databases: ["DB"],
          bindings: { TEST_MIGRATIONS: migrations, SESSION_SECRET: "test-secret", GOOGLE_CLIENT_ID: "cid.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "x", RESEND_API_KEY: "re_test" },
        },
      }),
    ],
    test: { include: ["test/**/*.test.js", "sites/**/*.test.js"], setupFiles: ["test/setup.js"] },
  };
});
