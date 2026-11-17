// Reuse the original updater network and digest validation, outside the WebView.
const { createInterface } = require('node:readline');
const service = require('./desktop-updates.cjs');
const input = createInterface({ input: process.stdin });
const controller = new AbortController();
let running = false;
let finished = false;
input.on('close', () => { if (running && !finished) controller.abort(); });
process.stdout.on('error', () => { controller.abort(); input.close(); process.stdin.destroy(); });
const fetcher=(url,init={})=>fetch(url,{...init,signal:AbortSignal.any([controller.signal,init.signal].filter(Boolean))});
function emit(message) { process.stdout.write(JSON.stringify(message) + '\n'); }
input.on('line', async line => {
  let request;
  try { request = JSON.parse(line); } catch { return; }
  if (request.action === 'cancel') { controller.abort(); return; }
  if (running) return;
  running = true;
  try {
    let value;
    if (request.action === 'check') value = await service.checkRelease(request.version,fetcher);
    else if (request.action === 'download') { value = await service.downloadRelease(request.release, request.directory,
      { fetch:fetcher,signal: controller.signal, onProgress: percent => emit({ progress: percent }) }); }
    else if (request.action === 'verify') { await service.verifyInstaller(request.file, request.release); value = true; }
    else if (request.action === 'shutdown') {
      const url = new URL(request.settingsUrl);
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('Invalid local host');
      const token = new URLSearchParams(url.hash.slice(1)).get('token');
      const result = await fetcher(url.origin + '/shutdown', { method: 'POST', headers: { 'x-dsh-pet-token': token }, signal: AbortSignal.timeout(10000) });
      if (!result.ok) throw new Error('退出失败：HTTP ' + result.status);
      value = true;
    } else throw new Error('Unsupported native service');
    emit({ result: value });
  } catch (error) { emit({ error: error.message, cancelled: controller.signal.aborted }); process.exitCode = 1; }
  finally { finished = true; input.close(); process.stdin.destroy(); }
});
