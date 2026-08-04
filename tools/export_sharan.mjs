#!/usr/bin/env node
// Export the procedural Sharan as .glb via GPU-headless Chromium (canvas
// textures need a real browser). Output: unreal/OlivosGP/SourceArt/sharan.glb
import { spawn, execSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { WebSocket } from 'ws';

const URL_ = process.argv[2] || 'http://localhost:4319/?export=sharan';
const OUT = process.argv[3] || 'unreal/OlivosGP/SourceArt/sharan.glb';
const PORT = 9378;
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, '--no-first-run', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  let targets = null;
  for (let i = 0; i < 50; i++) {
    await sleep(200);
    try {
      targets = JSON.parse(execSync(`curl -s http://127.0.0.1:${PORT}/json`, { encoding: 'utf8' }));
      if (targets.length) break;
    } catch { /* retry */ }
  }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
  await new Promise((r) => (ws.onopen = r));
  let msgId = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

  await send('Page.enable');
  await send('Page.navigate', { url: URL_ });
  await sleep(4000);
  const res = await send('Runtime.evaluate', {
    expression: 'window.__exportSharan()',
    awaitPromise: true,
    returnByValue: true,
  });
  const b64 = res.result?.result?.value;
  if (!b64) throw new Error('export failed: ' + JSON.stringify(res.result?.result).slice(0, 300));
  mkdirSync(OUT.substring(0, OUT.lastIndexOf('/')), { recursive: true });
  writeFileSync(OUT, Buffer.from(b64, 'base64'));
  console.log('wrote', OUT, Buffer.from(b64, 'base64').length, 'bytes');
  ws.close();
} finally {
  chrome.kill();
}
