#!/usr/bin/env node
// 真实浏览器端到端验证：Playwright Chromium 经局域网入口 Basic Auth 登录面板。
// httpCredentials 由 Playwright 在收到 401 challenge 时自动应答 —— 与用户在
// 弹框里输用户名密码完全同路，不需要把凭据写进 URL。
//
// 依赖：playwright（本机已有 chromium-1217 缓存；版本需与浏览器缓存匹配，如 1.59.0）
//   NODE_PATH=<有 playwright 的 node_modules> \
//   BASIC_USER=u BASIC_PASS=p TARGET_URL=http://172.16.2.238:3083/ \
//   SHOT=/tmp/panel.png node tests/browser-check.cjs
const pw = require(process.env.PLAYWRIGHT_MODULE || "playwright");

const TARGET = process.env.TARGET_URL || "http://172.16.2.238:3083/";
const SHOT = process.env.SHOT || "/tmp/panel-browser.png";
const SETTLE = Number(process.env.SETTLE_MS || 12000);

(async () => {
  const browser = await pw.chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const context = await browser.newContext({
    httpCredentials: { username: process.env.BASIC_USER, password: process.env.BASIC_PASS },
    viewport: { width: 1400, height: 900 },
  });
  const page = await context.newPage();

  const consoleErrors = [];
  const badResponses = [];
  const sockets = [];
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) consoleErrors.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
  page.on("pageerror", (e) => consoleErrors.push(`[uncaught] ${String(e).slice(0, 300)}`));
  page.on("response", (r) => { if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url().replace(/\?.*$/, "")}`); });
  page.on("websocket", (ws) => {
    const rec = { url: ws.url().replace(/\?.*$/, ""), frames: 0 };
    sockets.push(rec);
    ws.on("framereceived", () => { rec.frames += 1; });
    ws.on("close", () => { rec.closed = true; });
  });

  await page.goto(TARGET, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(SETTLE);

  const probe = await page.evaluate(() => JSON.stringify({
    url: location.href.replace(/\?.*$/, ""),
    title: document.title,
    boot: typeof window.__DSH_BOOT__ !== "undefined",
    rootHTML: (document.getElementById("root") || document.getElementById("app") || {}).innerHTML?.length || 0,
    bodyChars: document.body ? document.body.innerText.trim().length : 0,
    bodyText: (document.body ? document.body.innerText : "").trim().slice(0, 220),
    ready: document.readyState,
  }));

  console.log("=== 页面状态 ===");
  console.log(JSON.stringify(JSON.parse(probe), null, 1));
  console.log("=== 控制台 error/warning ===");
  console.log(consoleErrors.length ? [...new Set(consoleErrors)].slice(0, 12).join("\n") : "  （无）");
  console.log("=== >=400 响应（去 query）===");
  console.log(badResponses.length ? [...new Set(badResponses)].slice(0, 12).join("\n") : "  （无）");
  console.log("=== WebSocket ===");
  console.log(sockets.length ? sockets.map((s) => `${s.url} frames=${s.frames}${s.closed ? " closed" : ""}`).join("\n") : "  （未观察到）");

  await page.screenshot({ path: SHOT });
  console.log(`=== 截图 → ${SHOT} ===`);

  // 供调用方做断言的机器可读摘要
  const p = JSON.parse(probe);
  const ok = p.boot && p.rootHTML > 0 && badResponses.length === 0 && sockets.some((s) => s.frames > 0 && !s.closed);
  console.log(`RESULT=${ok ? "PASS" : "FAIL"}`);
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });