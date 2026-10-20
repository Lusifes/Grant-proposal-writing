import React, { useEffect, useState } from 'react';
import { KeyRound, Plug, Save, Trash2, RefreshCw, Plus, ArrowUp, ArrowDown, Pencil, RotateCcw, Check } from 'lucide-react';
import { useApp } from '../store.jsx';
import { api } from '../api.js';
import { Btn, Badge, Field, Modal, Spinner } from '../components/ui.jsx';

export default function Settings() {
  const { settings, meta, refreshSettings, refreshMeta, toast, projects, refreshProjects } = useApp();
  const [form, setForm] = useState({ provider: 'custom', baseUrl: '', model: '', apiKey: '' });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [editTpl, setEditTpl] = useState(null); // {id,name,structure,kind}
  const [newTplName, setNewTplName] = useState('');

  useEffect(() => {
    if (settings) {
      setForm((f) => ({ ...f, provider: settings.provider || 'custom', baseUrl: settings.baseUrl || '', model: settings.model || '' }));
    }
  }, [settings]);

  useEffect(() => {
    api.templates.list().then(setTemplates).catch(() => {});
  }, []);

  const applyProvider = (p) => {
    const d = meta && meta.defaults && meta.defaults[p];
    setForm((f) => ({ ...f, provider: p, baseUrl: d ? d.base : '', model: d && d.models[0] ? d.models[0] : f.model }));
    setTestResult(null);
  };

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.settings.save({ provider: form.provider, baseUrl: form.baseUrl, model: form.model, apiKey: form.apiKey || undefined });
      setForm((f) => ({ ...f, apiKey: '' }));
      await refreshSettings();
      toast('配置已保存（API Key 加密存储于本机服务端）', 'ok');
    } catch (e) { toast(e.message, 'err'); } finally { setSaving(false); }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await api.settings.test({ provider: form.provider, baseUrl: form.baseUrl, model: form.model, apiKey: form.apiKey || undefined });
      setTestResult(r);
    } catch (e) { setTestResult({ ok: false, message: e.message }); } finally { setTesting(false); }
  };

  const clearKey = async () => {
    try { await api.settings.clearKey(); await refreshSettings(); toast('API Key 已清除', 'ok'); } catch (e) { toast(e.message, 'err'); }
  };

  const openTpl = (t) => {
    setEditTpl({ ...t, structure: t.structure.map((c) => ({ ...c })) });
  };

  const saveTpl = async () => {
    if (!editTpl) return;
    try {
      if (editTpl.kind === 'custom') {
        await api.templates.update(editTpl.id, { name: editTpl.name, structure: editTpl.structure });
      } else {
        const created = await api.templates.create({ name: editTpl.name, structure: editTpl.structure });
        toast('已另存为自定义模板（内置模板保持原样）', 'ok');
        setEditTpl(null);
        setTemplates(await api.templates.list());
        return;
      }
      toast('模板已保存', 'ok');
      setEditTpl(null);
      setTemplates(await api.templates.list());
    } catch (e) { toast(e.message, 'err'); }
  };

  const resetTpl = async (id) => {
    try { await api.templates.reset(id); setTemplates(await api.templates.list()); toast('已恢复内置结构', 'ok'); } catch (e) { toast(e.message, 'err'); }
  };

  const providerLabel = meta && meta.providers && meta.providers[form.provider] ? meta.providers[form.provider].label : '自定义';

  return (
    <div className="page">
      <div className="page-inner">
        <div className="stage-head">
          <div className="grow">
            <div className="stage-title">设置</div>
            <div className="muted">AI 模型配置 · 申报模板管理</div>
          </div>
        </div>

        <div className="settings-grid">
          {/* API 配置 */}
          <div className="card card-pad">
            <div className="sec-label" style={{ marginBottom: 12 }}>AI 模型</div>
            <Field label="API 服务商">
              <select className="input" value={form.provider} onChange={(e) => applyProvider(e.target.value)}>
                {meta && Object.entries(meta.providers).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </Field>
            <Field label="Base URL" hint={form.provider === 'custom' ? 'OpenAI 兼容接口的 Base URL，如 https://your-host/v1（服务端会自动拼接 /chat/completions）' : '已按服务商预填，可修改'}>
              <input className="input" value={form.baseUrl} placeholder="https://api.openai.com/v1" onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
            </Field>
            <Field label="模型名称" hint="不同服务商模型 ID 不同，以服务商文档为准">
              <input className="input" list="model-list" value={form.model} placeholder="gpt-4o / deepseek-chat / doubao-seed-1-6-250615" onChange={(e) => setForm({ ...form, model: e.target.value })} />
              <datalist id="model-list">
                {meta && meta.providers[form.provider] && meta.providers[form.provider].models.map((m) => <option key={m} value={m} />)}
              </datalist>
            </Field>
            <Field label="API Key" hint="仅保存在本机服务端（AES-256 加密），不写入浏览器存储与日志。保存后回显仅显示掩码。">
              <input type="password" className="input" value={form.apiKey} placeholder={settings && settings.keySet ? `已配置（${settings.keyHint}），输入新值可覆盖` : 'sk-...'} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
            </Field>
            <div className="row">
              <Btn variant="primary" onClick={save} disabled={saving}><Save size={14} /> {saving ? '保存中…' : '保存配置'}</Btn>
              <Btn onClick={test} disabled={testing}><Plug size={14} /> {testing ? <Spinner size={12} /> : '测试连接'}</Btn>
              {settings && settings.keySet && <Btn variant="danger" onClick={clearKey}><Trash2 size={14} /> 清除密钥</Btn>}
            </div>
            {testResult && (
              <div className="card" style={{ marginTop: 12, padding: '10px 14px', fontSize: 13, borderColor: testResult.ok ? 'rgba(63,174,107,.4)' : 'rgba(224,82,82,.4)', color: testResult.ok ? 'var(--ok)' : 'var(--err)' }}>
                {testResult.ok ? '✓ ' : '✗ '}{testResult.message}
              </div>
            )}
            <div className="divider" />
            <div className="kv"><span className="k">当前服务商</span><span className="v">{providerLabel}</span></div>
            <div className="kv"><span className="k">当前模型</span><span className="v">{form.model || '—'}</span></div>
            <div className="kv"><span className="k">密钥状态</span><span className="v">{settings && settings.keySet ? <Badge tone="green" dot>已配置</Badge> : <Badge tone="amber" dot>未配置</Badge>}</span></div>
          </div>

          {/* 模板管理 */}
          <div className="card card-pad">
            <div className="sec-label" style={{ marginBottom: 12 }}>申报模板</div>
            {templates.map((t) => (
              <div key={t.id} className="tpl-row">
                <div className="row">
                  <div className="grow" style={{ fontWeight: 550 }}>{t.name}</div>
                  <Badge tone={t.kind === 'builtin' ? 'blue' : ''}>{t.kind === 'builtin' ? '内置' : '自定义'}</Badge>
                  <Btn size="sm" variant="ghost" onClick={() => openTpl(t)}><Pencil size={13} /> 编辑/另存</Btn>
                  {t.kind === 'builtin' && <Btn size="sm" variant="ghost" onClick={() => resetTpl(t.id)}><RotateCcw size={13} /> 恢复</Btn>}
                </div>
                <div className="tiny" style={{ marginTop: 4 }}>{t.structure.length} 个章节 · {t.kind === 'builtin' ? '可编辑并另存为自定义模板' : '自定义模板'}</div>
              </div>
            ))}
            <div className="tiny" style={{ marginTop: 4 }}>提示：新建项目时可选择申报类型；章节结构与提示词在此维护。具体申报规范请以官方当年指南为准。</div>
          </div>
        </div>

        {/* 模板编辑器 */}
        <Modal open={!!editTpl} onClose={() => setEditTpl(null)} title={editTpl ? `模板：${editTpl.name}` : ''} width="760px"
          footer={<>
            <Btn onClick={() => setEditTpl(null)}>取消</Btn>
            <Btn variant="primary" onClick={saveTpl}>
              {editTpl && editTpl.kind === 'builtin' ? '另存为自定义模板' : '保存模板'}
            </Btn>
          </>}>
          {editTpl && (
            <>
              <div className="row" style={{ marginBottom: 10 }}>
                <Field label="模板名称" className="grow">
                  <input className="input" value={editTpl.name} onChange={(e) => setEditTpl({ ...editTpl, name: e.target.value })} />
                </Field>
              </div>
              {editTpl.kind === 'builtin' && <div className="tiny" style={{ marginBottom: 10 }}>内置模板不可覆盖；保存时将创建一份自定义副本。</div>}
              <div className="divider" />
              {editTpl.structure.map((c, i) => (
                <div key={c.id} className="tpl-chapter">
                  <span className="tiny" style={{ width: 24, flex: 'none' }}>{i + 1}</span>
                  <input className="input" style={{ width: 170, flex: 'none' }} value={c.title} onChange={(e) => {
                    const s = [...editTpl.structure]; s[i] = { ...c, title: e.target.value }; setEditTpl({ ...editTpl, structure: s });
                  }} />
                  <input className="input" value={c.prompt} onChange={(e) => {
                    const s = [...editTpl.structure]; s[i] = { ...c, prompt: e.target.value }; setEditTpl({ ...editTpl, structure: s });
                  }} />
                  <Btn size="sm" variant="ghost" disabled={i === 0} onClick={() => {
                    const s = [...editTpl.structure]; const [x] = s.splice(i, 1); s.splice(i - 1, 0, x); setEditTpl({ ...editTpl, structure: s });
                  }}><ArrowUp size={13} /></Btn>
                  <Btn size="sm" variant="ghost" disabled={i === editTpl.structure.length - 1} onClick={() => {
                    const s = [...editTpl.structure]; const [x] = s.splice(i, 1); s.splice(i + 1, 0, x); setEditTpl({ ...editTpl, structure: s });
                  }}><ArrowDown size={13} /></Btn>
                  <Btn size="sm" variant="danger" onClick={() => {
                    const s = [...editTpl.structure]; s.splice(i, 1); setEditTpl({ ...editTpl, structure: s });
                  }}><Trash2 size={13} /></Btn>
                </div>
              ))}
              <Btn size="sm" style={{ marginTop: 10 }} onClick={() => setEditTpl({
                ...editTpl, structure: [...editTpl.structure, { id: 'c' + Date.now(), title: '新章节', guide: '', prompt: '起草该章节' }]
              })}><Plus size={13} /> 添加章节</Btn>
            </>
          )}
        </Modal>
      </div>
    </div>
  );
}
