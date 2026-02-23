import WebSocket from 'ws';

const relayUrl = process.argv[2] || 'ws://127.0.0.1:8888';
const channel = process.argv[3] || 'TDHTKSHJ';
const loops = Number(process.argv[4] || 1000);
const timeoutMs = Number(process.argv[5] || 2500);
const holdMs = Number(process.argv[6] || 0);
const url = `${relayUrl}?channel=${encodeURIComponent(channel)}&type=client`;

let ok = 0;
let fail = 0;
const failures = [];

function once(i) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    let done = false;

    const finish = (isOk, detail) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (isOk) ok += 1;
      else {
        fail += 1;
        if (failures.length < 20) failures.push({ i, ...detail });
      }
      try { ws.close(); } catch {}
      resolve();
    };

    const timer = setTimeout(() => finish(false, { reason: 'timeout' }), timeoutMs);

    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return finish(false, { reason: 'invalid_json', raw: String(data).slice(0, 160) });
      }

      if (msg?.type === 'system' && msg?.event === 'connected' && msg?.figmaConnected === true) {
        if (holdMs > 0) {
          setTimeout(() => finish(true), holdMs);
          return;
        }
        return finish(true);
      }
      if (msg?.type === 'system' && msg?.event === 'connected') {
        return finish(false, { reason: 'figma_not_connected', msg });
      }
      return finish(false, { reason: 'unexpected_message', msg });
    });

    ws.on('error', (err) => finish(false, { reason: 'ws_error', err: String(err?.message || err) }));
    ws.on('close', (code, reason) => finish(false, { reason: 'closed', code, closeReason: reason?.toString?.() || '' }));
  });
}

(async () => {
  const start = Date.now();
  for (let i = 1; i <= loops; i += 1) {
    await once(i);
    if (i % 100 === 0 || i === loops) {
      process.stdout.write(`[${i}/${loops}] ok=${ok} fail=${fail}\n`);
    }
  }
  const durationMs = Date.now() - start;
  const report = {
    relayUrl,
    channel,
    loops,
    ok,
    fail,
    successRate: `${((ok / loops) * 100).toFixed(2)}%`,
    durationMs,
    avgMsPerLoop: Number((durationMs / loops).toFixed(2)),
    failures,
  };
  console.log('---REPORT---');
  console.log(JSON.stringify(report, null, 2));
  process.exit(fail === 0 ? 0 : 2);
})();
