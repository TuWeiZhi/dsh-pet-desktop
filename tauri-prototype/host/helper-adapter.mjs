import { randomUUID } from 'node:crypto';
export const CONTROL = 'dsh-pet-control:';
const BRIDGE = 'dsh-pet-bridge:';

// Keep the original restart/backoff implementation; add only the native save barrier
// and bind replies to the process that actually made the request.
export function withTauriHelper(Base) {
  return class extends Base {
    start() {
      const child = super.start();
      this.controls ??= new Map();
      this.observed ??= new WeakSet();
      if (!child || this.observed.has(child)) return child;
      this.observed.add(child);
      child.stdout.setEncoding('utf8');
      let buffer = '';
      child.stdout.on('data', chunk => {
        buffer += String(chunk);
        for (let end; (end = buffer.indexOf('\n')) >= 0;) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          if (!line.startsWith(CONTROL)) continue;
          try {
            const result = JSON.parse(line.slice(CONTROL.length));
            const pending = this.controls.get(result.id);
            if (!pending || pending.child !== child) continue;
            this.controls.delete(result.id); clearTimeout(pending.timer);
            result.ok ? pending.resolve() : pending.reject(new Error(result.error || '便签未能保存'));
          } catch (error) { this.logger.warn?.(String(error)); }
        }
      });
      child.once('exit', () => {
        for (const [id, pending] of this.controls) if (pending.child === child) {
          this.controls.delete(id); clearTimeout(pending.timer);
          pending.reject(new Error('桌宠进程在保存确认前退出'));
        }
      });
      return child;
    }
    control(action) {
      const child = this.child;
      if (!child || child.exitCode !== null || child.stdin?.destroyed || this.stopping) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const id = randomUUID();
        const timer = setTimeout(() => { this.controls.delete(id); reject(new Error('等待便签保存超时')); }, 30000);
        this.controls.set(id, { child, resolve, reject, timer });
        child.stdin.write(CONTROL + JSON.stringify({ id, action }) + '\n', error => {
          if (error) { this.controls.delete(id); clearTimeout(timer); reject(error); }
        });
      });
    }
    async handleBridgeLine(line) {
      const child = this.child;
      if (!child?.stdin || !this.options.bridgeHandler) return;
      let req;
      try { req = JSON.parse(line.slice(BRIDGE.length)); } catch { return; }
      if (!Number.isSafeInteger(req.id)) return;
      let response;
      try { response = await this.options.bridgeHandler(req); }
      catch (error) { response = { id: req.id, status: 500, body: String(error) }; }
      if (this.child !== child || child.stdin.destroyed || child.exitCode !== null) return;
      child.stdin.write(BRIDGE + JSON.stringify(response) + '\n');
    }
  };
}

let mutations = Promise.resolve();
export function withRestartBarrier(args, operation, getHelper, waitForRestart) {
  const [rawUrl, method] = args;
  const route = decodeURIComponent(new URL(rawUrl, 'http://localhost').pathname);
  const needsSave = (route.endsWith('/config') && ['PUT', 'POST'].includes(method)) ||
    (method === 'POST' && ['/pet-display', '/reload'].some(suffix => route.endsWith(suffix)));
  if (!needsSave) return operation();
  const result = mutations.then(async () => {
    const helper = getHelper();
    try {
      await helper?.control('flush');
      const response = await operation();
      await waitForRestart();
      return response;
    } catch (error) {
      return { kind: 'json', status: 503, obj: { error: '便签未能保存，操作已取消：' + error.message } };
    } finally { await helper?.control('resume').catch(() => {}); }
  });
  mutations = result.then(() => {}, () => {});
  return result;
}
