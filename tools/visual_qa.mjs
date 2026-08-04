#!/usr/bin/env node
// Visual QA: drive GPU-headless Chromium via CDP, wait real time for tile
// streaming, then screenshot. Usage:
//   node tools/visual_qa.mjs <url> <out.png> [waitMs=40000] [w=1500] [h=900]
import { spawn, execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { WebSocket } from 'ws';

const [url, out, waitMs = '40000', w = '1500', h = '900'] = process.argv.slice(2);
const PORT = 9377;
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-first-run',
  '--hide-scrollbars',
  `--window-size=${w},${h}`,
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  // wait for CDP to come up
  let targets = null;
  for (let i = 0; i < 50; i++) {
    await sleep(200);
    try {
      targets = JSON.parse(execSync(`curl -s http://127.0.0.1:${PORT}/json`, { encoding: 'utf8' }));
      if (targets.length) break;
    } catch { /* retry */ }
  }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
  await new Promise((r) => (ws.onopen = r));
  let msgId = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  };
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

  await send('Page.enable');
  await send('Page.navigate', { url });
  console.log(`navigated, waiting ${waitMs}ms for tiles…`);
  await sleep(parseInt(waitMs, 10));

  // optional: hold W to drive before the screenshot (DRIVE_MS env var)
  const driveMs = parseInt(process.env.DRIVE_MS || '0', 10);
  if (driveMs > 0) {
    console.log(`driving for ${driveMs}ms…`);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 });
    await sleep(driveMs);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 });
    await sleep(400);
  }
  const dbg = await send('Runtime.evaluate', {
    expression: "document.getElementById('debug-overlay')?.textContent || 'no overlay'",
  });
  console.log('debug:', dbg.result?.result?.value);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  console.log('saved', out);
  ws.close();
} finally {
  chrome.kill();
}
