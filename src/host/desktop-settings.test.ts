import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import * as sourceConfig from './config.ts';

// The desktop release ships lib/standalone.js directly, so exercise that copy too.
const bundle = fs.readFileSync(new URL('../../lib/standalone.js', import.meta.url), 'utf8');
const configCode = bundle.slice(bundle.indexOf('//#region src/host/config.ts'), bundle.indexOf('//#endregion'));
const desktopConfig = runInNewContext(configCode + '\n({ readAllConfig, readUserConfig, saveUserConfig })', {
  ...fs, dirname, join, Buffer, console,
}) as typeof sourceConfig;

for (const [label, config] of [['source', sourceConfig], ['desktop release', desktopConfig]] as const) {
  test(`${label}: saved settings survive re-reading and replacement of the installed defaults`, () => {
    const dir = fs.mkdtempSync(join(tmpdir(), 'dsh-pet-settings-'));
    const paths = { defaultFile: join(dir, 'installed-default.jsonc'), userFile: join(dir, 'main-config.jsonc'), petDir: join(dir, 'pet') };
    const pet = { id: 'main', name: '我的 // 小鱼', size: 600, balanceEnabled: false,
      whisperEnabled: true, fixedEnabled: true, display: 'desktop',
      position: { corner: 'bottom-right', marginX: 12, marginY: 34 } };
    const custom = { pets: [pet], whisperLines: ['保留 // 后面的文字', '保留 /* 原样 */', '引号 " // 与反斜线 \\'],
      eventsRefreshSec: { whisper: 90, action: 10 } };
    try {
      const defaults = { pets: [{ ...pet, name: '默认名字', size: 462 }], whisperLines: [], eventsRefreshSec: { whisper: 300 } };
      fs.writeFileSync(paths.defaultFile, JSON.stringify(defaults));
      // Preserve user-only advanced values through a settings-page save.
      const saved = config.saveUserConfig({ pets: [pet] }, custom);
      assert.ok(saved);
      fs.writeFileSync(paths.userFile, JSON.stringify(saved));
      const original = fs.readFileSync(paths.userFile);
      for (const size of [462, 500, 350]) {
        defaults.pets[0].size = size;
        fs.writeFileSync(paths.defaultFile, JSON.stringify(defaults));
        const restored = config.readAllConfig(paths).main;
        assert.equal((restored.pets as typeof pet[])[0].name, pet.name);
        assert.equal((restored.pets as typeof pet[])[0].size, 600);
        assert.deepEqual(JSON.parse(JSON.stringify(restored.whisperLines)), custom.whisperLines);
        assert.deepEqual(JSON.parse(JSON.stringify(restored.eventsRefreshSec)), custom.eventsRefreshSec);
      }
      assert.deepEqual(fs.readFileSync(paths.userFile), original);
      fs.writeFileSync(paths.userFile, '\ufeff// outside comment\r\n' + JSON.stringify(custom, null, 2) + '\n/* outside */');
      assert.deepEqual(JSON.parse(JSON.stringify(config.readUserConfig(paths))), custom);
      fs.writeFileSync(paths.userFile, '{"size":4/* not a joined number */62}');
      assert.equal(config.readUserConfig(paths), undefined, 'comments cannot join invalid JSON tokens');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}

function settingsFixture(aiSettings: Record<string, unknown> = { protocol: 'anthropic', model: 'test' },
  modelResponse: (body: any) => Promise<any> = async () => ({ ok: true, models: [], message: '暂无模型' })) {
  const elements = new Map<string, any>();
  const element = (id: string) => {
    if (!elements.has(id)) elements.set(id, { value: '', checked: false, disabled: id === 'save', textContent: '',
      dataset: {}, listeners: {}, options: [], reportValidity: () => true, checkValidity: () => true,
      setAttribute() {},
      replaceChildren(...options: unknown[]) { this.options = options; },
      appendChild(option: unknown) { this.options.push(option); },
      addEventListener(name: string, fn: any) {
        const previous = this.listeners[name];
        this.listeners[name] = (event: unknown) => { previous?.(event); return fn(event); };
      } });
    return elements.get(id);
  };
  let resolveConfig!: (value: unknown) => void;
  const pendingConfig = new Promise(resolve => { resolveConfig = resolve; });
  const writes: string[] = [];
  runInNewContext(fs.readFileSync(new URL('../../tools/settings-page/script.js.txt', import.meta.url), 'utf8'), {
    URLSearchParams, AbortController, location: { hash: '#token=test', pathname: '/standalone-ai/' },
    history: { replaceState() {} }, document: { getElementById: element, createElement: () => ({}) },
    fetch: async (url: string, options: { method: string; body?: string }) => {
      if (url.endsWith('/models')) return { ok: true, json: () => modelResponse(JSON.parse(options.body!)) };
      if (options.method !== 'GET') writes.push(url);
      if (url.endsWith('/config') && options.method === 'PUT') {
        const clean = desktopConfig.saveUserConfig(JSON.parse(options.body!));
        assert.ok(clean);
        return { ok: true, json: async () => ({ main: clean }) };
      }
      if (url.endsWith('/config')) return pendingConfig;
      if (options.method === 'POST') aiSettings = { ...aiSettings, ...JSON.parse(options.body!), hasKey: true };
      return { ok: true, json: async () => aiSettings };
    },
  });
  return { element, resolveConfig, writes };
}

test('settings cannot report a successful save while pet configuration is still loading', async () => {
  const { element, resolveConfig, writes } = settingsFixture();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(element('save').disabled, true);
  await element('settings').listeners.submit({ preventDefault() {} });
  assert.deepEqual(writes, []);
  resolveConfig({ ok: true, json: async () => ({ main: { pets: [{ id: 'main', name: 'saved pet', size: 600 }] } }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(element('save').disabled, false);
  assert.equal(element('petName').value, 'saved pet');
});

test('loaded settings save pet appearance and zero action delay before reporting success', async () => {
  const { element, resolveConfig, writes } = settingsFixture();
  resolveConfig({ ok: true, json: async () => ({ main: { pets: [{ id: 'main', name: 'saved pet', size: 600,
    position: { corner: 'bottom-right', marginX: 12, marginY: 34 } }] } }) });
  await new Promise(resolve => setImmediate(resolve));
  element('petName').value = '小鱼 // 名字';
  element('petSize').value = '720';
  element('whisperLines').value = '保留 /* 文字 */';
  element('actionSec').value = '0';
  await element('settings').listeners.submit({ preventDefault() {} });
  assert.deepEqual(writes, ['/dsh-pet-7340/config', '/standalone-ai/settings']);
  assert.equal(element('status').textContent, '已保存到本机。');
  assert.equal(element('petName').value, '小鱼 // 名字');
  assert.equal(element('petSize').value, '720');
  assert.equal(element('whisperLines').value, '保留 /* 文字 */');
  assert.equal(element('actionSec').value, '0');
});

test('failed pet configuration load keeps saving disabled and retains the error', async () => {
  const { element, resolveConfig, writes } = settingsFixture();
  resolveConfig({ ok: false, status: 500, json: async () => ({ error: 'config unavailable' }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(element('save').disabled, true);
  assert.equal(element('status').dataset.error, 'true');
  await element('settings').listeners.submit({ preventDefault() {} });
  assert.deepEqual(writes, []);
});

test('model picker loads with the saved key, preserves selection and saves the selected ID', async () => {
  const calls: any[] = [];
  const { element, resolveConfig } = settingsFixture({
    protocol: 'openai-compatible', baseUrl: 'https://example.test/v1', model: 'saved-model', hasKey: true,
  }, async body => {
    calls.push(body);
    return { ok: true, message: '已获取 2 个模型', models: [
      { id: 'saved-model', name: 'Saved' }, { id: 'new-model', name: 'New' },
    ] };
  });
  resolveConfig({ ok: true, json: async () => ({ main: { pets: [{ id: 'main', name: 'pet', size: 462,
    position: { corner: 'bottom-right', marginX: 12, marginY: 34 } }] } }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls[0].apiKey, '');
  assert.equal(element('model').value, 'saved-model');
  assert.equal(element('model').options.length, 3);
  assert.equal(element('model').disabled, false);
  element('model').value = 'new-model';
  await element('settings').listeners.submit({ preventDefault() {} });
  assert.equal(element('model').value, 'new-model');
  assert.equal(element('status').textContent, '已保存到本机。');
  assert.equal(element('apiKey').value, '');
});

test('model picker ignores stale results, reports errors and retries without retaining another connection model', async () => {
  let finishOld!: (value: unknown) => void;
  const oldResponse = new Promise(resolve => { finishOld = resolve; });
  const { element } = settingsFixture({ protocol: 'openai-compatible', model: '' }, async body => {
    if (body.baseUrl.includes('old')) return oldResponse;
    if (body.apiKey === 'wrong') return { ok: false, message: '身份验证失败' };
    return { ok: true, message: '已获取 1 个模型', models: [{ id: 'new-model', name: 'New' }] };
  });
  await new Promise(resolve => setImmediate(resolve));
  element('baseUrl').value = 'https://old.example/v1';
  element('apiKey').value = 'new-key';
  const loading = element('models-btn').listeners.click();
  assert.equal(element('models-btn').disabled, true);
  element('baseUrl').value = 'https://new.example/v1';
  element('baseUrl').listeners.input();
  await element('models-btn').listeners.click();
  finishOld({ ok: true, models: [{ id: 'old-model', name: 'Old' }], message: 'old result' });
  await loading;
  assert.deepEqual(element('model').options.map((option: any) => option.value), ['', 'new-model']);
  element('model').value = 'new-model';
  element('apiKey').value = 'wrong';
  element('apiKey').listeners.input();
  assert.equal(element('model').value, '');
  await element('models-btn').listeners.click();
  assert.equal(element('models-note').dataset.error, 'true');
  assert.equal(element('models-btn').disabled, false);
  assert.equal(element('model').disabled, true);
  element('apiKey').value = 'correct';
  await element('models-btn').listeners.click();
  assert.equal(element('model').disabled, false);
  element('clearApiKey').checked = true;
  element('clearApiKey').listeners.change();
  assert.equal(element('model').value, '');
  assert.equal(element('models-btn').disabled, true);
});
