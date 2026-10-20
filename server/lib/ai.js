'use strict';
// 统一模型调用适配层：OpenAI / DeepSeek / 豆包（火山方舟）/ 自定义 OpenAI 兼容接口。
// 全部走 /chat/completions 协议；适配不同 Base URL 形态，不做“全兼容”假设。

const PROVIDERS = {
  openai: {
    label: 'OpenAI',
    base: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'o3-mini'],
    placeholder: 'sk-...'
  },
  deepseek: {
    label: 'DeepSeek',
    base: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    placeholder: 'sk-...'
  },
  doubao: {
    label: '豆包（火山方舟）',
    base: 'https://ark.cn-beijing.volces.com/api/v3',
    models: [
      'doubao-seed-1-6-250615',
      'doubao-seed-1-6-251108',
      'doubao-1-5-pro-32k-250115',
      'doubao-1-5-vision-pro-32k-250115',
      'doubao-1-5-flash-32k-250115'
    ],
    placeholder: '火山方舟 API Key 或 Endpoint ID 对应密钥'
  },
  custom: {
    label: '自定义（OpenAI 兼容）',
    base: '',
    models: [],
    placeholder: 'API Key'
  }
};

class ApiError extends Error {
  constructor(message, code = 'provider') {
    super(message);
    this.code = code;
  }
}

function chatEndpoint(base) {
  let b = String(base || '').trim().replace(/\/+$/, '');
  if (!b) return null;
  if (/\/chat\/completions$/.test(b)) return b;
  return b + '/chat/completions';
}

function describeStatus(status) {
  if (status === 401 || status === 403) return `API Key 无效或无权访问（HTTP ${status}），请检查密钥与账户权限`;
  if (status === 404) return `接口地址不存在（HTTP 404），请检查 Base URL 是否正确`;
  if (status === 429) return `请求过于频繁或账户额度不足（HTTP 429），请稍后重试或检查账户额度`;
  if (status >= 500) return `模型服务端错误（HTTP ${status}），请稍后重试`;
  return `模型调用失败（HTTP ${status}）`;
}

function buildFetchArgs(settings, messages, { maxTokens, temperature, stream }) {
  const endpoint = chatEndpoint(settings.baseUrl);
  if (!endpoint) throw new ApiError('Base URL 未配置或格式不正确', 'config');
  if (!settings.apiKey) throw new ApiError('未配置 API Key，请前往「设置 → AI 模型」填写', 'config');
  if (!settings.model) throw new ApiError('未配置模型名称，请前往设置页选择或填写', 'config');
  const body = {
    model: settings.model,
    messages,
    temperature: temperature ?? 0.4,
    max_tokens: maxTokens || 2048,
    stream
  };
  return {
    endpoint,
    args: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify(body)
    }
  };
}

async function chatOnce(settings, messages, { signal, maxTokens, temperature } = {}) {
  const { endpoint, args } = buildFetchArgs(settings, messages, { maxTokens, temperature, stream: false });
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (signal) signal.addEventListener('abort', onAbort);
  let res;
  try {
    res = await fetch(endpoint, { ...args, signal: ctrl.signal });
  } catch (e) {
    if (signal) signal.removeEventListener('abort', onAbort);
    if (e.name === 'AbortError') throw new ApiError('已取消生成', 'cancelled');
    throw new ApiError(`无法连接到模型服务（${e.message}），请检查 Base URL 与网络`, 'network');
  }
  if (signal) signal.removeEventListener('abort', onAbort);
  if (!res.ok) throw new ApiError(describeStatus(res.status), 'provider');
  let data;
  try {
    data = await res.json();
  } catch (e) {
    throw new ApiError('模型返回了无法解析的内容（非 JSON）', 'provider');
  }
  const text = data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : '';
  if (!text) throw new ApiError('模型返回内容为空，请重试', 'provider');
  return text;
}

async function chatStream(settings, messages, { signal, maxTokens, temperature, onDelta } = {}) {
  const { endpoint, args } = buildFetchArgs(settings, messages, { maxTokens, temperature, stream: true });
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (signal) signal.addEventListener('abort', onAbort);
  let res;
  try {
    res = await fetch(endpoint, { ...args, signal: ctrl.signal });
  } catch (e) {
    if (signal) signal.removeEventListener('abort', onAbort);
    if (e.name === 'AbortError') throw new ApiError('已取消生成', 'cancelled');
    throw new ApiError(`无法连接到模型服务（${e.message}），请检查 Base URL 与网络`, 'network');
  }
  if (signal) signal.removeEventListener('abort', onAbort);
  if (!res.ok) throw new ApiError(describeStatus(res.status), 'provider');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let json;
      try {
        json = JSON.parse(payload);
      } catch (e) {
        continue;
      }
      const delta = json.choices && json.choices[0] && json.choices[0].delta
        ? json.choices[0].delta.content
        : '';
      if (delta && typeof onDelta === 'function') onDelta(delta);
    }
  }
}

async function testConnection(settings) {
  const text = await chatOnce(settings, [
    { role: 'user', content: '请只回复两个字：正常' }
  ], { maxTokens: 16, temperature: 0 });
  return text;
}

module.exports = { PROVIDERS, chatOnce, chatStream, testConnection, ApiError, chatEndpoint };
