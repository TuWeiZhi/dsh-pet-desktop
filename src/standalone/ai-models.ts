import { validateSettings } from './ai-config';
import type { StandaloneAiSettings } from './ai-config';
import type { AiFetch } from './ai-transport';

export type ModelListResult = {
  ok: boolean;
  message: string;
  models?: Array<{ id: string; name: string }>;
};

/** Discover models using the unsaved connection fields without changing stored settings. */
export async function fetchAvailableModels(
  input: unknown,
  current: Readonly<StandaloneAiSettings>,
  fetcher: AiFetch,
): Promise<ModelListResult> {
  let settings: StandaloneAiSettings;
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid input');
    settings = validateSettings({ ...input, enabled: false }, current);
  } catch {
    return { ok: false, message: '请检查接口协议、接口地址和 API 密钥格式' };
  }
  if (!settings.baseUrl) return { ok: false, message: '请先填写接口地址（Base URL）' };
  if (!settings.apiKey) return { ok: false, message: '请先填写 API 密钥' };

  const base = settings.baseUrl.replace(/\/+$/, '');
  const anthropic = settings.protocol === 'anthropic';
  const endpoint = base + (anthropic && !base.endsWith('/v1') ? '/v1/models' : '/models');
  const headers = new Headers({ accept: 'application/json' });
  if (anthropic) {
    headers.set('x-api-key', settings.apiKey);
    headers.set('anthropic-version', '2023-06-01');
  } else headers.set('authorization', `Bearer ${settings.apiKey}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const models = new Map<string, { id: string; name: string }>();
    const cursors = new Set<string>();
    let after = '';
    do {
      const url = new URL(endpoint);
      if (after) url.searchParams.set('after_id', after);
      const response = await fetcher(url, { method: 'GET', headers, signal: controller.signal, redirect: 'error' });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403)
          return { ok: false, message: '身份验证失败：请检查 API 密钥是否正确或具有模型列表权限' };
        if (response.status === 404)
          return { ok: false, message: '未找到模型列表接口：请检查 Base URL，或确认服务商支持获取模型列表' };
        if (response.status === 429)
          return { ok: false, message: '获取过于频繁，请稍后重试' };
        return { ok: false, message: `获取模型失败（HTTP ${response.status}）` };
      }
      const body = await response.json();
      if (!body || !Array.isArray(body.data))
        return { ok: false, message: '服务商返回的模型列表格式无效' };
      for (const item of body.data) {
        if (!item || typeof item.id !== 'string') continue;
        const id = item.id.trim();
        if (!id || id.length > 200 || /[\u0000-\u001f\u007f]/.test(id)) continue;
        const name = typeof item.display_name === 'string' ? item.display_name.trim() : id;
        models.set(id, { id, name: name || id });
      }
      after = anthropic && body.has_more === true ? body.last_id : '';
      if (after) {
        if (typeof after !== 'string' || cursors.has(after))
          return { ok: false, message: '服务商返回的模型分页信息无效' };
        cursors.add(after);
      } else if (anthropic && body.has_more === true) {
        return { ok: false, message: '服务商返回的模型分页信息无效' };
      }
    } while (after);
    const available = [...models.values()].sort((a, b) => a.id.localeCompare(b.id));
    return {
      ok: true,
      models: available,
      message: available.length ? `已获取 ${available.length} 个模型，请从下拉框选择` : '该接口未返回可用模型，请检查密钥权限或联系服务商',
    };
  } catch {
    return {
      ok: false,
      message: controller.signal.aborted ? '获取模型超时（15 秒），请稍后重试' : '无法获取模型列表，请检查接口地址、网络或服务商状态',
    };
  } finally {
    clearTimeout(timer);
  }
}
