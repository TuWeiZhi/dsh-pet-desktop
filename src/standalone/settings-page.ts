/** Local-only settings shell; external same-origin assets keep CSP free of unsafe-inline. */
export const settingsPage = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>桌宠 AI 设置</title><link rel="stylesheet" href="/standalone-ai/settings.css">
<script src="/standalone-ai/settings.js" defer></script></head><body>
<main><header><span class="fish" aria-hidden="true">🐾</span><p class="local">独立桌宠 / 本机设置</p>
<h1>桌宠 AI 设置</h1><p class="intro">配置你的大模型 API 接口，开启桌面聊天与碎碎念。<br>所有设置仅保存在本机，支持即时测试连接。</p></header>
<form id="settings" aria-describedby="privacy">
<fieldset><legend>模型连接</legend>
<label for="protocol">接口协议</label><select id="protocol" name="protocol"><option value="openai-compatible">OpenAI 兼容</option><option value="anthropic">Anthropic</option></select>
<label for="baseUrl">接口地址（Base URL）</label><input id="baseUrl" name="baseUrl" type="url" placeholder="https://example.com/v1" maxlength="2048" spellcheck="false" aria-describedby="endpoint-note"><p class="hint" id="endpoint-note">填写服务商提供的基础接口地址（支持 HTTP 与 HTTPS，通常以 /v1 结尾）。不要把密钥放进地址。</p>
<div class="key-heading"><label for="apiKey">API 密钥</label><span id="key-state" class="hint">尚未读取</span></div>
<input id="apiKey" name="apiKey" type="password" autocomplete="new-password" maxlength="8192" placeholder="留空保留已保存的密钥" aria-describedby="key-note">
<p id="key-note" class="hint">密钥只写入本机配置，不会回显。留空不会删除旧密钥。</p>
<label class="check clear"><input id="clearApiKey" type="checkbox">清除已保存的密钥，并关闭 AI</label>
<label for="model">模型名称</label><div class="model-row"><select id="model" name="model" disabled aria-describedby="models-note"><option value="">请先获取模型列表</option></select><button id="models-btn" type="button" disabled>获取模型</button></div>
<p id="models-note" class="hint" role="status" aria-live="polite">填写接口地址和密钥后获取模型，再从下拉框选择。</p>
<label class="check enabled"><input id="enabled" type="checkbox">启用 AI 对话</label>
<div class="test-row"><button id="test-btn" type="button">测试连接</button><span id="test-result" class="test-result" role="status" aria-live="polite"></span></div>
</fieldset>
<fieldset><legend>定时自动碎碎念</legend>
<label class="check"><input id="automaticWhispers" type="checkbox" aria-describedby="cost">开启自动碎碎念</label>
<p id="cost" class="notice">开启后，桌宠会按设定间隔定时调用模型并在桌面上说话冒泡（产生 API 费用）。默认关闭；右键菜单中的手动对话与手动碎碎念不受此开关限制。</p>
<div class="pair"><div><label for="whisperIntervalSec">碎碎念间隔（秒）</label><input id="whisperIntervalSec" type="number" min="60" max="86400" step="1" value="300" required></div>
<div><label for="maxTokens">单次输出上限（tokens）</label><input id="maxTokens" type="number" min="128" max="4096" step="1" value="1024" required></div></div>
<p class="hint">间隔至少 60 秒，默认 300 秒。输出上限越小，单次回复越简短。</p>
</fieldset>
<footer><p id="privacy">所有配置与密钥仅保存在当前机器。<br>关闭 AI 后，桌宠仍可正常显示、移动与互动。</p><button id="save" type="submit" disabled>保存到本机</button></footer>
<p id="status" role="status" aria-live="polite">正在读取本机设置…</p>
</form><noscript>需要启用 JavaScript 才能保存设置。请从桌宠菜单打开本页。</noscript></main></body></html>`;

export const settingsStyle = `
.model-row{display:flex;align-items:center;gap:10px}.model-row select{flex:1;min-width:0}.model-row button{flex-shrink:0}#models-note[data-error=true]{color:#a13b30}select:disabled{background:#f2f5f7;color:var(--muted)}
@media(max-width:560px){.model-row{align-items:stretch;flex-direction:column}}
:root{color-scheme:light;--ink:#203b4b;--muted:#526a78;--blue:#12618b;--line:#cbdce5;--paper:#fff;--water:#edf5fa}
*{box-sizing:border-box}body{margin:0;background:var(--water);color:var(--ink);font:16px/1.6 "Microsoft YaHei UI","PingFang SC",sans-serif}
main{max-width:720px;margin:48px auto;padding:0 24px 32px}header{padding:0 12px 28px}.fish{display:block;font:700 29px/1.3 Georgia,serif;color:var(--blue);letter-spacing:2px;margin-bottom:24px}.local{font-size:13px;color:var(--muted);margin:0 0 10px}h1{font-size:32px;line-height:1.3;letter-spacing:-1px;margin:0 0 16px;font-weight:700}.intro{margin:0;color:var(--muted)}
form{background:var(--paper);border:1px solid var(--line);border-radius:16px 16px 6px 6px;padding:28px 32px 20px}fieldset{padding:0 0 28px;margin:0 0 24px;border:0;border-bottom:1px solid var(--line);min-width:0}legend{font-size:19px;font-weight:700;margin-bottom:18px;padding:0}label{display:block;font-weight:600;font-size:14px;margin:14px 0 6px}input:not([type=checkbox]),select{display:block;width:100%;min-height:44px;border:1px solid #a5bdcb;border-radius:6px;background:#fff;color:var(--ink);padding:9px 12px;font:inherit;font-size:15px}input::placeholder{color:#6a7e8b}input[type=checkbox]{accent-color:var(--blue);width:18px;height:18px;flex-shrink:0;margin:0}.check{display:flex;align-items:center;gap:10px;min-height:32px;cursor:pointer}.enabled{margin-top:24px}.clear{font-weight:400;color:var(--muted);font-size:13px}.hint{font-size:12px;line-height:1.6;color:var(--muted);margin:7px 0 0}.key-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:14px}.key-heading label{margin:0 0 6px}.key-heading .hint{margin:0 0 6px}.notice{font-size:13px;color:#704b13;background:#fff7e7;border-left:3px solid #c18e36;margin:12px 0 16px;padding:12px 14px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}footer{display:flex;align-items:center;justify-content:space-between;gap:18px}footer p{font-size:12px;color:var(--muted);margin:0}button{border:0;border-radius:7px;min-height:44px;padding:10px 20px;background:var(--blue);color:#fff;font:600 15px/1.5 inherit;white-space:nowrap;cursor:pointer}button:hover{background:#0b4e73}button:disabled{opacity:.55;cursor:wait}:focus-visible{outline:3px solid #3a94c4;outline-offset:3px}#status{font-size:13px;min-height:24px;margin:18px 0 0;color:var(--blue)}#status[data-error=true]{color:#a13b30}
.test-row{display:flex;align-items:center;gap:14px;margin:20px 0 6px;flex-wrap:wrap}#test-btn{background:#fff;color:var(--blue);border:1.5px solid var(--blue);min-height:38px;padding:6px 18px;font-size:14px;border-radius:6px;cursor:pointer;font-weight:600}#test-btn:hover{background:#edf5fa}#test-btn:disabled{opacity:.6;cursor:wait}.test-result{font-size:13px;line-height:1.5;min-height:22px;flex:1 1 200px}.test-success{color:#1a7f37;font-weight:600}.test-error{color:#cf222e}.reply-preview{display:block;color:var(--muted);font-weight:normal;font-size:12px;margin-top:4px;word-break:break-all}
@media(max-width:560px){main{margin:24px auto;padding:0 14px 24px}header{padding:0 8px 24px}h1{font-size:28px}form{padding:24px 20px 16px}.pair{grid-template-columns:1fr;gap:0}footer{align-items:stretch;flex-direction:column}button{width:100%}.fish{margin-bottom:18px}}
`;

export const settingsScript = `
'use strict';
(() => {
  const token = new URLSearchParams(location.hash.slice(1)).get('token') || '';
  history.replaceState(null, '', location.pathname);
  const get = id => document.getElementById(id);
  const form = get('settings');
  const status = get('status');
  const save = get('save');
  const testBtn = get('test-btn');
  const testResult = get('test-result');

  const modelBox = get('model');
  const modelsBtn = get('models-btn');
  const modelsNote = get('models-note');
  let hasStoredKey = false;
  let modelRequest = 0;
  let modelController = null;

  function modelMessage(text, error = false) {
    modelsNote.textContent = text;
    modelsNote.dataset.error = String(error);
  }

  function showModels(models, selected = '') {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = models.length ? '请选择模型' : '请先获取模型列表';
    modelBox.replaceChildren(placeholder);
    for (const model of models) {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = model.name === model.id ? model.id : model.name + '（' + model.id + '）';
      modelBox.appendChild(option);
    }
    modelBox.value = models.some(model => model.id === selected) ? selected : '';
    modelBox.disabled = models.length === 0;
  }

  function canFetchModels() {
    return !!get('baseUrl').value.trim() && get('baseUrl').checkValidity() &&
      !get('clearApiKey').checked && (!!get('apiKey').value.trim() || hasStoredKey);
  }

  function cancelModelRequest() {
    modelRequest += 1;
    if (modelController) modelController.abort();
    modelController = null;
    modelBox.setAttribute('aria-busy', 'false');
    modelsBtn.textContent = '获取模型';
    modelsBtn.disabled = !token || get('clearApiKey').checked;
  }

  function invalidateModels() {
    cancelModelRequest();
    showModels([]);
    modelMessage('连接信息已修改，请重新获取模型列表。');
  }

  async function loadModels() {
    cancelModelRequest();
    if (!canFetchModels()) {
      modelMessage('请先填写有效的接口地址和 API 密钥；已保存的密钥可留空。', true);
      return;
    }
    const requestId = modelRequest;
    const selected = modelBox.value;
    modelController = new AbortController();
    modelsBtn.disabled = true;
    modelsBtn.textContent = '正在获取…';
    modelBox.disabled = true;
    modelBox.setAttribute('aria-busy', 'true');
    modelMessage('正在获取可用模型…');
    try {
      const response = await fetch('/standalone-ai/models', {
        method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error',
        signal: modelController.signal,
        headers: { 'X-DSH-Pet-Token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          protocol: get('protocol').value,
          baseUrl: get('baseUrl').value.trim(),
          apiKey: get('apiKey').value.trim(),
          clearApiKey: get('clearApiKey').checked
        })
      });
      if (response.status === 403) throw new Error('打开凭据已失效，请从桌宠菜单重新打开设置。');
      const data = await response.json();
      if (requestId !== modelRequest) return;
      if (!response.ok || !data.ok) throw new Error(data.message || data.error || '获取模型失败，请重试。');
      showModels(data.models, selected);
      modelMessage(data.message, data.models.length === 0);
    } catch (error) {
      if (requestId !== modelRequest) return;
      modelMessage(error.message || '获取模型失败，请检查连接后重试。', true);
    } finally {
      if (requestId === modelRequest) {
        modelController = null;
        modelsBtn.disabled = false;
        modelsBtn.textContent = '获取模型';
        modelBox.disabled = modelBox.options.length <= 1;
        modelBox.setAttribute('aria-busy', 'false');
      }
    }
  }

  function populateModels(data) {
    cancelModelRequest();
    hasStoredKey = data.hasKey === true;
    showModels(data.model ? [{ id: data.model, name: data.model }] : [], data.model);
    modelMessage('填写接口地址和密钥后获取模型，再从下拉框选择。');
    if (canFetchModels()) void loadModels();
  }

  modelsBtn.addEventListener('click', loadModels);
  for (const id of ['baseUrl', 'apiKey']) {
    get(id).addEventListener('input', invalidateModels);
    get(id).addEventListener('change', () => { if (canFetchModels()) void loadModels(); });
  }
  get('protocol').addEventListener('change', () => {
    invalidateModels();
    if (canFetchModels()) void loadModels();
  });
  get('clearApiKey').addEventListener('change', () => {
    invalidateModels();
    if (canFetchModels()) void loadModels();
  });

  function message(text, error = false) { status.textContent = text; status.dataset.error = String(error); }
  async function request(method, body) {
    const response = await fetch('/standalone-ai/settings', {
      method, credentials: 'omit', cache: 'no-store', redirect: 'error',
      headers: { 'X-DSH-Pet-Token': token, ...(body ? {'Content-Type': 'application/json'} : {}) },
      ...(body ? {body: JSON.stringify(body)} : {})
    });
    if (!response.ok) {
      if (response.status === 403) throw new Error('打开凭据已失效。请从桌宠菜单重新打开设置。');
      if (response.status === 429) throw new Error('保存过于频繁，请稍等一分钟再试。');
      throw new Error('设置未保存。请检查接口地址、模型名称与密钥，再重试。');
    }
    return response.json();
  }
  function populate(data) {
    for (const id of ['protocol','baseUrl','whisperIntervalSec','maxTokens']) {
      if (data[id] !== undefined) get(id).value = String(data[id]);
    }
    for (const id of ['enabled','automaticWhispers']) get(id).checked = data[id] === true;
    get('key-state').textContent = data.hasKey ? '已保存 · 不回显' : '尚未设置';
    get('apiKey').value = '';
    get('clearApiKey').checked = false;
    populateModels(data);
  }
  get('clearApiKey').addEventListener('change', () => {
    get('apiKey').disabled = get('clearApiKey').checked;
    if (get('clearApiKey').checked) {
      get('apiKey').value = '';
      get('enabled').checked = false;
      get('automaticWhispers').checked = false;
    }
  });
  if (testBtn && testResult) {
    testBtn.addEventListener('click', async () => {
      testBtn.disabled = true;
      testResult.className = 'test-result';
      testResult.textContent = '正在测试连接，请稍候…';
      const input = {
        protocol: get('protocol').value,
        baseUrl: get('baseUrl').value.trim(),
        model: get('model').value.trim(),
        apiKey: get('apiKey').value.trim(),
      };
      try {
        const response = await fetch('/standalone-ai/test', {
          method: 'POST',
          credentials: 'omit',
          cache: 'no-store',
          headers: {
            'X-DSH-Pet-Token': token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(input),
        });
        const data = await response.json();
        if (data.ok) {
          testResult.className = 'test-result test-success';
          testResult.textContent = '✓ ' + data.message;
          if (data.reply) {
            const preview = document.createElement('span');
            preview.className = 'reply-preview';
            preview.textContent = '回复: ' + data.reply;
            testResult.appendChild(preview);
          }
        } else {
          testResult.className = 'test-result test-error';
          testResult.textContent = '✗ ' + (data.message || data.error || '测试失败');
        }
      } catch (error) {
        testResult.className = 'test-result test-error';
        testResult.textContent = '✗ 请求异常：' + (error && error.message ? error.message : String(error));
      } finally {
        testBtn.disabled = false;
      }
    });
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    if (get('enabled').checked && !modelBox.value) { message('请先获取并选择模型。', true); return; }
    save.disabled = true;
    message('正在保存到本机…');
    const input = {
      protocol: get('protocol').value, baseUrl: get('baseUrl').value.trim(), model: get('model').value.trim(),
      apiKey: get('apiKey').value, clearApiKey: get('clearApiKey').checked,
      enabled: get('enabled').checked, automaticWhispers: get('automaticWhispers').checked,
      whisperIntervalSec: Number(get('whisperIntervalSec').value), maxTokens: Number(get('maxTokens').value)
    };
    get('apiKey').value = '';
    try {
      populate(await request('POST', input));
      get('apiKey').disabled = false;
      message('已保存到本机。');
    } catch (error) { message(error.message, true); }
    finally { save.disabled = false; }
  });
  if (!token) { message('请从桌宠菜单或本机启动器打开设置，以获得本次运行的访问凭据。', true); return; }
  request('GET').then(data => { populate(data); save.disabled = false; message('设置只在本机保存。'); })
    .catch(error => message(error.message, true));
})();
`;
