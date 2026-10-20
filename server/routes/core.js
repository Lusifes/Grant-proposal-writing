'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { db, UPLOAD_DIR, TEMPLATES } = require('../db');
const { encrypt, decrypt, maskKey } = require('../lib/secret');
const { PROVIDERS, testConnection, ApiError } = require('../lib/ai');

const router = express.Router();
const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

// ---------- 设置 ----------
function getAISettings() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('ai');
  if (!row) return null;
  try {
    const cfg = JSON.parse(row.value);
    return {
      provider: cfg.provider || 'custom',
      baseUrl: cfg.baseUrl || '',
      model: cfg.model || '',
      apiKey: cfg.apiKey ? decrypt(cfg.apiKey) : ''
    };
  } catch (e) {
    return null;
  }
}

function saveAISettings({ provider, baseUrl, model, apiKey, clearKey }) {
  const old = getAISettings() || {};
  const next = {
    provider: provider || old.provider || 'custom',
    baseUrl: (baseUrl !== undefined ? baseUrl : old.baseUrl) || '',
    model: (model !== undefined ? model : old.model) || '',
    apiKey: old.apiKey
  };
  if (clearKey) next.apiKey = null;
  else if (apiKey && String(apiKey).trim()) next.apiKey = encrypt(String(apiKey).trim());
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run('ai', JSON.stringify(next));
  return { provider: next.provider, baseUrl: next.baseUrl, model: next.model, keySet: !!next.apiKey };
}

router.get('/health', (req, res) => res.json({ ok: true, time: now() }));

router.get('/settings/meta', (req, res) => {
  res.json({
    providers: PROVIDERS,
    defaults: Object.fromEntries(Object.entries(PROVIDERS).map(([k, v]) => [k, { base: v.base, models: v.models }]))
  });
});

router.get('/settings', (req, res) => {
  const s = getAISettings();
  res.json({
    provider: s ? s.provider : 'custom',
    baseUrl: s ? s.baseUrl : '',
    model: s ? s.model : '',
    keySet: !!(s && s.apiKey),
    keyHint: s && s.apiKey ? maskKey(s.apiKey) : ''
  });
});

router.put('/settings', (req, res) => {
  const { provider, baseUrl, model, apiKey } = req.body || {};
  const saved = saveAISettings({ provider, baseUrl, model, apiKey });
  res.json({ ok: true, ...saved, keyHint: saved.keySet ? maskKey(decrypt(JSON.parse(db.prepare('SELECT value FROM settings WHERE key=?').get('ai').value).apiKey)) : '' });
});

router.delete('/settings/key', (req, res) => {
  const s = getAISettings();
  if (s) saveAISettings({ clearKey: true, provider: s.provider, baseUrl: s.baseUrl, model: s.model });
  res.json({ ok: true, keySet: false });
});

router.post('/settings/test', async (req, res, next) => {
  try {
    const saved = getAISettings() || {};
    const body = req.body || {};
    const settings = {
      provider: body.provider || saved.provider || 'custom',
      baseUrl: body.baseUrl !== undefined ? body.baseUrl : (saved.baseUrl || ''),
      model: body.model || saved.model || '',
      apiKey: body.apiKey ? String(body.apiKey).trim() : (saved.apiKey || '')
    };
    const reply = await testConnection(settings);
    res.json({ ok: true, message: '连接成功：' + String(reply).slice(0, 80) });
  } catch (e) {
    res.json({ ok: false, message: e.message || '连接失败' });
  }
});

// ---------- 项目 ----------
const GRANT_TEMPLATE = {
  '国家自然科学基金面上项目': 'nsfc_face',
  '科技研发项目': 'rnd_project',
  '通用项目申请书': 'general'
};

function projectRow(row) {
  if (!row) return null;
  return { ...row };
}

router.get('/projects', (req, res) => {
  const rows = db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all();
  res.json(rows.map(projectRow));
});

function projectDetail(id) {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (!p) return null;
  const lit = db.prepare('SELECT COUNT(*) n FROM literatures WHERE project_id = ?').get(id);
  const verified = db.prepare("SELECT COUNT(*) n FROM literatures WHERE project_id = ? AND status != 'metadata_only'").get(id);
  const questions = db.prepare("SELECT COUNT(*) n FROM artifacts WHERE project_id = ? AND kind = 'question'").get(id);
  const confirmedQ = db.prepare("SELECT COUNT(*) n FROM artifacts WHERE project_id = ? AND kind = 'question' AND confirmed = 1").get(id);
  const todos = db.prepare("SELECT COUNT(*) n FROM todos WHERE project_id = ? AND status = 'pending'").get(id);
  const recent = db.prepare('SELECT id, stage, kind, title, updated_at FROM artifacts WHERE project_id = ? ORDER BY updated_at DESC LIMIT 6').all(id);
  return { ...p, stats: { literatures: lit.n, verified: verified.n, questions: questions.n, confirmedQ: confirmedQ.n, todosPending: todos.n }, recent };
}

router.get('/projects/:id', (req, res) => {
  const d = projectDetail(req.params.id);
  if (!d) return res.status(404).json({ error: '项目不存在' });
  res.json(d);
});

router.post('/projects', (req, res) => {
  const { name, direction = '', grant_type = '通用项目申请书', year = '', foundation = '', requirements = '', ai_mode = 'restricted', template_id } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: '请填写项目名称' });
  const id = uid();
  const tplId = template_id || GRANT_TEMPLATE[grant_type] || 'general';
  db.prepare(`INSERT INTO projects (id, name, direction, grant_type, template_id, year, foundation, requirements, ai_mode, created_at, updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, String(name).trim(), String(direction).trim(), grant_type, tplId, String(year).trim(), String(foundation), String(requirements), ai_mode, now(), now());
  res.json(projectDetail(id));
});

router.patch('/projects/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: '项目不存在' });
  const allow = ['name', 'direction', 'grant_type', 'template_id', 'year', 'foundation', 'requirements', 'ai_mode'];
  const sets = [];
  const vals = [];
  for (const k of allow) {
    if (req.body && k in req.body) {
      sets.push(`${k} = ?`);
      vals.push(req.body[k]);
    }
  }
  if (!sets.length) return res.json(projectDetail(req.params.id));
  sets.push('updated_at = ?');
  vals.push(now());
  vals.push(req.params.id);
  db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  res.json(projectDetail(req.params.id));
});

router.patch('/projects/:id/stage', (req, res) => {
  const { stage, status } = req.body || {};
  const field = { 1: 'stage1', 2: 'stage2', 3: 'stage3' }[stage];
  const valid = ['not_started', 'in_progress', 'pending_review', 'completed'];
  if (!field || !valid.includes(status)) return res.status(400).json({ error: '无效的阶段或状态' });
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: '项目不存在' });
  db.prepare(`UPDATE projects SET ${field} = ?, updated_at = ? WHERE id = ?`).run(status, now(), req.params.id);
  res.json(projectDetail(req.params.id));
});

router.delete('/projects/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: '项目不存在' });
  const ups = db.prepare('SELECT stored_name, kind FROM uploads WHERE project_id = ?').all(req.params.id);
  for (const u of ups) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, u.stored_name)); } catch (e) {}
  }
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- 模板 ----------
router.get('/templates', (req, res) => {
  const rows = db.prepare('SELECT * FROM templates ORDER BY kind, created_at').all();
  res.json(rows.map((r) => ({ ...r, structure: JSON.parse(r.structure) })));
});

router.post('/templates', (req, res) => {
  const { name, structure } = req.body || {};
  if (!name || !Array.isArray(structure) || !structure.length) return res.status(400).json({ error: '模板名称与章节结构不能为空' });
  const id = 'custom_' + uid().slice(0, 8);
  db.prepare('INSERT INTO templates (id, name, kind, structure, created_at) VALUES (?,?,?,?,?)')
    .run(id, String(name).trim(), 'custom', JSON.stringify(structure), now());
  res.json({ id, name: String(name).trim(), kind: 'custom', structure });
});

router.put('/templates/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: '模板不存在' });
  if (t.kind === 'builtin') return res.status(400).json({ error: '内置模板不允许覆盖，请另存为自定义模板' });
  const { name, structure } = req.body || {};
  if (name) db.prepare('UPDATE templates SET name = ? WHERE id = ?').run(String(name).trim(), req.params.id);
  if (Array.isArray(structure)) db.prepare('UPDATE templates SET structure = ? WHERE id = ?').run(JSON.stringify(structure), req.params.id);
  const row = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
  res.json({ ...row, structure: JSON.parse(row.structure) });
});

router.post('/templates/:id/reset', (req, res) => {
  const t = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: '模板不存在' });
  if (t.kind === 'builtin' && TEMPLATES[t.id]) {
    db.prepare('UPDATE templates SET structure = ? WHERE id = ?').run(JSON.stringify(TEMPLATES[t.id].structure), req.params.id);
  }
  const row = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
  res.json({ ...row, structure: JSON.parse(row.structure) });
});

// ---------- 待确认事项 ----------
router.get('/projects/:id/todos', (req, res) => {
  res.json(db.prepare('SELECT * FROM todos WHERE project_id = ? ORDER BY status, created_at').all(req.params.id));
});

router.post('/projects/:id/todos', (req, res) => {
  const { text, stage = 1 } = req.body || {};
  if (!text) return res.status(400).json({ error: '内容不能为空' });
  const id = uid();
  db.prepare('INSERT INTO todos (id, project_id, stage, text, status, created_at) VALUES (?,?,?,?,?,?)')
    .run(id, req.params.id, stage, String(text), 'pending', now());
  res.json(db.prepare('SELECT * FROM todos WHERE id = ?').get(id));
});

router.patch('/projects/:id/todos/:tid', (req, res) => {
  const { status } = req.body || {};
  if (!['pending', 'done'].includes(status)) return res.status(400).json({ error: '无效状态' });
  db.prepare('UPDATE todos SET status = ? WHERE id = ? AND project_id = ?').run(status, req.params.tid, req.params.id);
  res.json(db.prepare('SELECT * FROM todos WHERE id = ?').get(req.params.tid));
});

module.exports = { router, getAISettings, saveAISettings, projectDetail, uid, now };
