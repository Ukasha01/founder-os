// Smoke tests that need no login. Run against any deployment:  BASE_URL=https://... node tests/e2e/smoke.mjs
// They prove the public surface is safe: private pages and data routes bounce to /login, the reminder
// job refuses callers without the secret, security headers are present, and the offline files are public.
import { chromium } from "playwright";
const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
let failed = 0;
const check = (ok, name, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}: ${name}${ok ? "" : " " + extra}`); if (!ok) failed++; };

const get = (path, init = {}) => fetch(BASE + path, { redirect: "manual", ...init });
for (const path of ["/", "/tasks", "/assistant", "/settings", "/api/export", "/api/calendar"]) {
  const r = await get(path);
  check([302, 303, 307, 308].includes(r.status) && (r.headers.get("location") || "").includes("/login"), `${path} redirects a signed-out visitor to /login`, `(got ${r.status})`);
}
const cron = await get("/api/cron/reminders");
check([401, 503].includes(cron.status), "reminder job refuses a caller without the secret", `(got ${cron.status})`);
const cron2 = await get("/api/cron/reminders", { headers: { authorization: "Bearer wrong" } });
check([401, 503].includes(cron2.status), "reminder job refuses a wrong secret", `(got ${cron2.status})`);
const off = await get("/offline.html"); check(off.status === 200, "offline page is public", `(got ${off.status})`);
const sw = await get("/sw.js"); check(sw.status === 200 && (await sw.text()).includes("offline.html"), "service worker is served");
const man = await get("/manifest.webmanifest"); check(man.status === 200, "manifest is served", `(got ${man.status})`);
const login = await get("/login");
check(login.status === 200, "login page loads", `(got ${login.status})`);
for (const [h, v] of [["x-frame-options", "DENY"], ["x-content-type-options", "nosniff"]]) check((login.headers.get(h) || "").toUpperCase() === v.toUpperCase(), `header ${h}`);
check((login.headers.get("content-security-policy") || "").includes("frame-ancestors 'none'"), "header content-security-policy");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
await page.goto(BASE + "/login");
check(await page.getByRole("button", { name: /sign in|log in/i }).first().isVisible(), "login form shows a sign-in button on a phone-sized screen");
check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "login page has no sideways scroll on a phone");
await page.goto(BASE + "/offline.html");
await page.fill("#t", "smoke test note");
await page.click("button");
await page.waitForSelector("#m:has-text('Saved on this device')");
const stored = await page.evaluate(() => new Promise((res) => { const o = indexedDB.open("founder-os-offline", 1); o.onsuccess = () => { const r = o.result.transaction("capture_queue").objectStore("capture_queue").getAll(); r.onsuccess = () => res(r.result); }; }));
check(stored.length === 1 && stored[0].raw_text === "smoke test note" && stored[0].status === "pending" && /^[0-9a-f-]{36}$/.test(stored[0].id), "offline page stores the capture in IndexedDB with a request id");
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : "\nAll smoke checks passed");
process.exit(failed ? 1 : 0);
