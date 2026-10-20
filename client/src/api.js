async function j(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts
  });
  if (!res.ok) {
    let msg = `请求失败（HTTP ${res.status}）`;
    try { const e = await res.json(); if (e && e.error) msg = e.error; } catch (e) {}
    throw new Error(msg);
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res;
}

export const api = {
  projects: {
    list: () => j('/api/projects'),
    get: (id) => j(`/api/projects/${id}`),
    create: (body) => j('/api/projects', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => j(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    remove: (id) => j(`/api/projects/${id}`, { method: 'DELETE' }),
    setStage: (id, stage, status) => j(`/api/projects/${id}/stage`, { method: 'PATCH', body: JSON.stringify({ stage, status }) })
  },
  settings: {
    get: () => j('/api/settings'),
    meta: () => j('/api/settings/meta'),
    save: (body) => j('/api/settings', { method: 'PUT', body: JSON.stringify(body) }),
    clearKey: () => j('/api/settings/key', { method: 'DELETE' }),
    test: (body) => j('/api/settings/test', { method: 'POST', body: JSON.stringify(body) })
  },
  templates: {
    list: () => j('/api/templates'),
    create: (body) => j('/api/templates', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => j(`/api/templates/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    reset: (id) => j(`/api/templates/${id}/reset`, { method: 'POST' })
  },
  literatures: {
    list: (pid) => j(`/api/projects/${pid}/literatures`),
    add: (pid, body) => j(`/api/projects/${pid}/literatures`, { method: 'POST', body: JSON.stringify(body) }),
    update: (lid, body) => j(`/api/literatures/${lid}`, { method: 'PATCH', body: JSON.stringify(body) }),
    remove: (lid) => j(`/api/literatures/${lid}`, { method: 'DELETE' }),
    analyze: (lid, jobId, signal) => j(`/api/literatures/${lid}/analyze`, { method: 'POST', body: JSON.stringify({ jobId }), signal })
  },
  workflow: {
    stage1Run: (pid, body, signal) => j(`/api/projects/${pid}/stage1/run`, { method: 'POST', body: JSON.stringify(body), signal }),
    stage1Report: (pid, body, signal) => j(`/api/projects/${pid}/stage1/report`, { method: 'POST', body: JSON.stringify(body), signal }),
    stage1Complete: (pid) => j(`/api/projects/${pid}/stage1/complete`, { method: 'POST' }),
    stage2Cross: (pid, jobId, signal) => j(`/api/projects/${pid}/stage2/cross`, { method: 'POST', body: JSON.stringify({ jobId }), signal }),
    stage2Complete: (pid) => j(`/api/projects/${pid}/stage2/complete`, { method: 'POST' }),
    stage3Data: (pid) => j(`/api/projects/${pid}/stage3`),
    stage3Save: (pid, body) => j(`/api/projects/${pid}/stage3/save`, { method: 'POST', body: JSON.stringify(body) }),
    stage3Version: (pid, body) => j(`/api/projects/${pid}/stage3/version`, { method: 'POST', body: JSON.stringify(body) }),
    stage3Check: (pid, jobId, signal) => j(`/api/projects/${pid}/stage3/check`, { method: 'POST', body: JSON.stringify({ jobId }), signal })
  },
  artifacts: {
    list: (pid) => j(`/api/projects/${pid}/artifacts`),
    create: (body) => j('/api/artifacts', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => j(`/api/artifacts/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    remove: (id) => j(`/api/artifacts/${id}`, { method: 'DELETE' }),
    matrixCell: (id, body) => j(`/api/artifacts/${id}/matrix-cell`, { method: 'POST', body: JSON.stringify(body) }),
    versions: (id) => j(`/api/artifacts/${id}/versions`),
    restore: (id, version) => j(`/api/artifacts/${id}/restore`, { method: 'POST', body: JSON.stringify({ version }) })
  },
  todos: {
    list: (pid) => j(`/api/projects/${pid}/todos`),
    add: (pid, body) => j(`/api/projects/${pid}/todos`, { method: 'POST', body: JSON.stringify(body) }),
    update: (pid, tid, status) => j(`/api/projects/${pid}/todos/${tid}`, { method: 'PATCH', body: JSON.stringify({ status }) })
  },
  uploads: {
    list: (pid) => j(`/api/projects/${pid}/uploads`),
    downloadUrl: (id) => `/api/uploads/${id}/download`,
    text: (id) => j(`/api/uploads/${id}/text`),
    upload: async (pid, file, kind = 'material') => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('kind', kind);
      const res = await fetch(`/api/projects/${pid}/uploads`, { method: 'POST', body: fd });
      if (!res.ok) {
        let msg = '上传失败';
        try { const e = await res.json(); if (e.error) msg = e.error; } catch (e) {}
        throw new Error(msg);
      }
      return res.json();
    },
    uploadFulltext: async (lid, file) => {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/literatures/${lid}/fulltext`, { method: 'POST', body: fd });
      if (!res.ok) {
        let msg = '上传失败';
        try { const e = await res.json(); if (e.error) msg = e.error; } catch (e) {}
        throw new Error(msg);
      }
      return res.json();
    }
  }
};

export const jobId = () => 'job_' + Math.random().toString(36).slice(2) + Date.now().toString(36);

export async function streamChat({ jobId: jid, messages, temperature, maxTokens, onDelta, signal }) {  const res = await fetch('/api/ai/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId: jid, messages, temperature, maxTokens }),
    signal
  });
  if (!res.ok) {
    let msg = '调用失败';
    try { const e = await res.json(); if (e.error) msg = e.error; } catch (e) {}
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let msg;
      try { msg = JSON.parse(payload); } catch (e) { continue; }
      if (msg.delta) { text += msg.delta; if (onDelta) onDelta(msg.delta, text); }
      else if (msg.error) throw new Error(msg.error);
      else if (msg.done) return { text, artifact: msg.artifact, aborted: !!msg.aborted };
    }
  }
  return { text, aborted: false };
}

export function cancelJob(jid) {
  return fetch(`/api/ai/cancel/${jid}`, { method: 'POST' }).catch(() => {});
}

// 通用 SSE 消费：用于 stage3 generate / assist 等服务端流式端点
export async function streamEndpoint(url, body, { onDelta, signal } = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal
  });
  if (!res.ok) {
    let msg = '调用失败';
    try { const e = await res.json(); if (e.error) msg = e.error; } catch (e) {}
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let msg;
      try { msg = JSON.parse(payload); } catch (e) { continue; }
      if (msg.delta) { text += msg.delta; if (onDelta) onDelta(msg.delta, text); }
      else if (msg.error) throw new Error(msg.error);
      else if (msg.done) return { text, artifact: msg.artifact, aborted: !!msg.aborted };
    }
  }
  return { text, aborted: false };
}

export function download(url, name) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name || '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
