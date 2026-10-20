import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  Search, PenTool, FileText, Download, Upload, Trash2, Pencil, Play, X,
  RefreshCw, PanelRight, Plus, Sparkles, History, ExternalLink, ClipboardList,
  Lightbulb, ArrowLeft, ArrowRight, LayoutDashboard, Settings, BookOpenCheck,
  FileText as FileTextIcon, StopCircle, CheckCircle2, ChevronRight,
  MessageSquare, Send
} from 'lucide-react';
import { useApp, STAGE_INFO } from '../store.jsx';
import { api, jobId, cancelJob, streamEndpoint, download } from '../api.js';
import { Btn, Badge, EmptyState, Field, Modal, Spinner, StatusBadge, GuideBar, LIT_STATUS } from '../components/ui.jsx';
import Markdown from '../md.jsx';
import { navigate } from '../router.js';

/* ================= 主工作区 ================= */
export default function Workspace({ projectId, stage }) {
  const [project, setProject] = useState(null);
  const [ctxOpen, setCtxOpen] = useState(true);
  const { toast, setRunning } = useApp();

  const loadProject = useCallback(async () => {
    try {
      setProject(await api.projects.get(projectId));
    } catch (e) { toast(e.message, 'err'); }
  }, [projectId]);

  useEffect(() => { loadProject(); }, [loadProject]);

  useEffect(() => () => setRunning(null), [setRunning]);

  if (!project) {
    return <div className="page"><div className="page-inner muted">加载项目…</div></div>;
  }

  return (
    <div className="ws">
      <Sidebar project={project} stage={stage} />
      <div className="ws-center">
        <StageHeader project={project} stage={stage} onProjectChange={loadProject}
          onToggleCtx={() => setCtxOpen(!ctxOpen)} ctxOpen={ctxOpen} />
        {stage === 1 && <Stage1View pid={projectId} project={project} onProjectChange={loadProject} />}
        {stage === 2 && <Stage2View pid={projectId} project={project} onProjectChange={loadProject} />}
        {stage === 3 && <Stage3View pid={projectId} project={project} onProjectChange={loadProject} />}
      </div>
      <ContextPanel pid={projectId} stage={stage} open={ctxOpen} />
    </div>
  );
}

function Sidebar({ project, stage }) {
  const pid = project.id;
  const { running } = useApp();
  return (
    <div className="ws-side">
      <div className="side-sec">
        <div className="side-proj-name">{project.name}</div>
        <div className="tiny">{project.grant_type}{project.year ? ' · ' + project.year : ''}</div>
      </div>
      <div className="side-sec">
        <span className="sec-label">项目</span>
        <div className="ws-nav-item" onClick={() => navigate(`/p/${pid}`)}><LayoutDashboard size={15} /> 工作台</div>
      </div>
      <div className="side-sec">
        <span className="sec-label">三阶段工作流</span>
        {[1, 2, 3].map((s) => (
          <div key={s} className={`ws-nav-item ${stage === s ? 'active' : ''}`} onClick={() => navigate(`/p/${pid}/stage/${s}`)}>
            {s === 1 ? <Search size={15} /> : s === 2 ? <PenTool size={15} /> : <FileText size={15} />}
            {STAGE_INFO[s].name}
            {running && running.stage === s && <span className="run-dot" title={running.label || '任务运行中'} />}
            <span className="st"><StatusBadge status={project[`stage${s}`]} /></span>
          </div>
        ))}
      </div>
      <div className="side-sec">
        <div className="ws-nav-item" onClick={() => navigate('/settings')}><Settings size={15} /> 设置</div>
      </div>
    </div>
  );
}

function StageHeader({ project, stage, onProjectChange, onToggleCtx, ctxOpen }) {
  const { toast } = useApp();
  const info = STAGE_INFO[stage];
  const back = async () => {
    try {
      if (stage === 2) { await api.projects.setStage(project.id, 1, 'in_progress'); navigate(`/p/${project.id}/stage/1`); }
      if (stage === 3) { await api.projects.setStage(project.id, 2, 'in_progress'); navigate(`/p/${project.id}/stage/2`); }
      toast('已返回上一阶段（可修订）', 'ok');
      onProjectChange();
    } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <div className="stage-head">
      <div className="grow">
        <div className="stage-title">{info.name}</div>
        <div className="muted">{info.step} · {info.sub}</div>
      </div>
      {stage > 1 && project[`stage${stage - 1}`] === 'completed' && (
        <Btn size="sm" variant="ghost" onClick={back}><ArrowLeft size={14} /> 返回修订上一阶段</Btn>
      )}
      <Btn variant={ctxOpen ? 'ghost' : 'primary'} size="sm" onClick={onToggleCtx}>
        <PanelRight size={14} /> 上下文面板
      </Btn>
    </div>
  );
}

/* ================= 文献行 ================= */
function LitRow({ lit, pid, onChanged, analyzing, onAnalyze }) {
  const { toast } = useApp();
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState({ title: lit.title, note: lit.note, abstract: lit.abstract, year: lit.year || '', doi: lit.doi, url: lit.url });
  const fileRef = useRef(null);
  const st = LIT_STATUS[lit.status] || LIT_STATUS.metadata_only;

  const toggleSelect = async (e) => {
    try {
      await api.literatures.update(lit.id, { selected: e.target.checked ? 1 : 0 });
      onChanged();
    } catch (err) { toast(err.message, 'err'); }
  };

  const uploadPdf = async (file) => {
    try {
      const r = await api.uploads.uploadFulltext(lit.id, file);
      toast(r.extracted ? `全文已提取（${r.chars} 字符）` : `上传完成，但文本提取失败：${r.message || '未知原因'}`, r.extracted ? 'ok' : 'err');
      onChanged();
    } catch (e) { toast(e.message, 'err'); }
  };

  const saveEdit = async () => {
    try {
      await api.literatures.update(lit.id, form);
      setEdit(false);
      onChanged();
    } catch (e) { toast(e.message, 'err'); }
  };

  const remove = async () => {
    if (!window.confirm(`删除文献：${lit.title}？`)) return;
    try { await api.literatures.remove(lit.id); onChanged(); } catch (e) { toast(e.message, 'err'); }
  };

  return (
    <div className="lit-row">
      <div className="head">
        <input type="checkbox" className="checkbox" checked={lit.selected === 1} onChange={toggleSelect} title="选为核心论文" />
        <div className="grow" onClick={() => setOpen(!open)}>
          <div className="lit-title">{lit.title}</div>
          <div className="lit-meta">
            <span>{(lit.authors || []).slice(0, 4).join(', ') || '作者未知'}{lit.year ? '，' + lit.year : ''}</span>
            <Badge tone={st.tone}>{st.label}</Badge>
            {lit.doi && <Badge>DOI: {lit.doi.slice(0, 28)}{lit.doi.length > 28 ? '…' : ''}</Badge>}
            {lit.fulltext_url && <Badge tone="blue">开放全文链接</Badge>}
            {lit.source && <span>{lit.source}</span>}
          </div>
        </div>
        <ChevronRight size={15} style={{ color: 'var(--text-4)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />
      </div>
      {open && (
        <div className="body">
          {lit.abstract && (
            <div className="muted" style={{ marginBottom: 10 }}>
              <div className="tiny" style={{ marginBottom: 3, textTransform: 'uppercase', letterSpacing: '.06em' }}>摘要</div>
              {lit.abstract.slice(0, 1200)}{lit.abstract.length > 1200 ? '…' : ''}
            </div>
          )}
          {lit.analysis && (
            <div style={{ marginTop: 6 }}>
              <div className="tiny" style={{ marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-3)' }}>批判性分析</div>
              <Markdown text={lit.analysis} />
            </div>
          )}
          <div className="lit-actions">
            <Btn size="sm" onClick={() => onAnalyze && onAnalyze(lit.id)} disabled={analyzing}>
              {analyzing ? <Spinner size={12} /> : <Sparkles size={13} />} {analyzing ? '分析中…' : 'AI 分析'}
            </Btn>
            <Btn size="sm" onClick={() => fileRef.current && fileRef.current.click()}><Upload size={13} /> 上传全文 PDF</Btn>
            <input ref={fileRef} type="file" accept=".pdf,application/pdf" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files[0]; if (f) uploadPdf(f); e.target.value = ''; }} />
            <Btn size="sm" onClick={() => setEdit(true)}><Pencil size={13} /> 编辑</Btn>
            <Btn size="sm" variant="ghost" onClick={() => window.open(lit.url, '_blank')} disabled={!lit.url}><ExternalLink size={13} /> 来源</Btn>
            <Btn size="sm" variant="danger" onClick={remove}><Trash2 size={13} /> 删除</Btn>
          </div>
        </div>
      )}
      <Modal open={edit} onClose={() => setEdit(false)} title="编辑文献"
        footer={<>
          <Btn onClick={() => setEdit(false)}>取消</Btn>
          <Btn variant="primary" onClick={saveEdit}>保存</Btn>
        </>}>
        <Field label="标题"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
        <div className="row">
          <Field label="年份" className="grow"><input className="input" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} /></Field>
          <Field label="DOI" className="grow"><input className="input" value={form.doi} onChange={(e) => setForm({ ...form, doi: e.target.value })} /></Field>
        </div>
        <Field label="来源链接"><input className="input" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} /></Field>
        <Field label="摘要"><textarea className="textarea" value={form.abstract} onChange={(e) => setForm({ ...form, abstract: e.target.value })} /></Field>
        <Field label="备注"><input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
      </Modal>
    </div>
  );
}

/* ================= 候选问题列表 ================= */
function QuestionList({ pid, questions, onChanged }) {
  const { toast } = useApp();
  const [editQ, setEditQ] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ title: '', support: '', objection: '', unverified: '' });

  const setConfirmed = async (q, v) => {
    try {
      await api.artifacts.update(q.id, { confirmed: v ? 1 : 0 });
      onChanged();
      toast(v ? '已确认该科学问题（将进入申报写作）' : '已取消确认', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  };
  const removeQ = async (q) => {
    if (!window.confirm('删除该候选问题？')) return;
    try { await api.artifacts.remove(q.id); onChanged(); } catch (e) { toast(e.message, 'err'); }
  };
  const saveEditQ = async () => {
    try {
      const meta = { support: editQ.support, objection: editQ.objection, unverified: editQ.unverified };
      await api.artifacts.update(editQ.id, { title: editQ.title, content: `- 支持证据：${editQ.support}\n- 最强反对意见：${editQ.objection}\n- 未验证条件：${editQ.unverified}`, meta });
      setEditQ(null); onChanged(); toast('已保存', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  };
  const addQ = async () => {
    if (!addForm.title.trim()) return toast('请填写问题标题', 'err');
    try {
      const content = `- 支持证据：${addForm.support}\n- 最强反对意见：${addForm.objection}\n- 未验证条件：${addForm.unverified}`;
      await api.artifacts.create({ project_id: pid, stage: 2, kind: 'question', title: addForm.title, content });
      setShowAdd(false);
      setAddForm({ title: '', support: '', objection: '', unverified: '' });
      onChanged(); toast('已添加候选问题', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  };

  return (
    <div className="card card-pad" style={{ marginTop: 14 }}>
      <div className="row" style={{ marginBottom: 8 }}>
        <div className="grow sec-label">候选科学问题</div>
        <Btn size="sm" onClick={() => setShowAdd(true)}><Plus size={13} /> 手动添加</Btn>
      </div>
      {!questions.length && <EmptyState icon={<Lightbulb size={22} />} text="暂无候选问题。运行阶段任务生成，或手动添加。" />}
      {questions.map((q) => {
        const meta = q.meta || {};
        return (
          <div key={q.id} className="ctx-item" style={{ flexDirection: 'column', padding: '10px 0' }}>
            <div className="row" style={{ width: '100%' }}>
              <div className="grow" style={{ fontWeight: 550 }}>{q.title}</div>
              {q.confirmed === 1 ? <Badge tone="green" dot>已确认</Badge> : <Badge tone="amber">待确认</Badge>}
            </div>
            {q.content && <div className="muted" style={{ whiteSpace: 'pre-wrap', fontSize: 12.5 }}>{q.content}</div>}
            <div className="row" style={{ marginTop: 6 }}>
              {q.confirmed === 1
                ? <Btn size="sm" variant="ghost" onClick={() => setConfirmed(q, false)}>取消确认</Btn>
                : <Btn size="sm" variant="ok" onClick={() => setConfirmed(q, true)}><CheckCircle2 size={13} /> 确认</Btn>}
              <Btn size="sm" variant="ghost" onClick={() => setEditQ({ ...q, meta: { ...q.meta } })}><Pencil size={13} /> 修改</Btn>
              <Btn size="sm" variant="danger" onClick={() => removeQ(q)}><Trash2 size={13} /> 否决/删除</Btn>
            </div>
          </div>
        );
      })}
      <Modal open={!!editQ} onClose={() => setEditQ(null)} title="编辑候选问题"
        footer={<>
          <Btn onClick={() => setEditQ(null)}>取消</Btn>
          <Btn variant="primary" onClick={saveEditQ}>保存</Btn>
        </>}>
        <Field label="问题标题"><input className="input" value={editQ ? editQ.title : ''} onChange={(e) => setEditQ({ ...editQ, title: e.target.value })} /></Field>
        <Field label="支持证据"><textarea className="textarea" style={{ minHeight: 50 }} value={editQ ? editQ.support : ''} onChange={(e) => setEditQ({ ...editQ, support: e.target.value })} /></Field>
        <Field label="最强反对意见"><textarea className="textarea" style={{ minHeight: 50 }} value={editQ ? editQ.objection : ''} onChange={(e) => setEditQ({ ...editQ, objection: e.target.value })} /></Field>
        <Field label="未验证条件"><textarea className="textarea" style={{ minHeight: 50 }} value={editQ ? editQ.unverified : ''} onChange={(e) => setEditQ({ ...editQ, unverified: e.target.value })} /></Field>
      </Modal>
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="手动添加候选问题"
        footer={<>
          <Btn onClick={() => setShowAdd(false)}>取消</Btn>
          <Btn variant="primary" onClick={addQ}>添加</Btn>
        </>}>
        <Field label="问题标题"><input className="input" value={addForm.title} onChange={(e) => setAddForm({ ...addForm, title: e.target.value })} /></Field>
        <Field label="支持证据（可选）"><textarea className="textarea" style={{ minHeight: 50 }} value={addForm.support} onChange={(e) => setAddForm({ ...addForm, support: e.target.value })} /></Field>
        <Field label="最强反对意见（可选）"><textarea className="textarea" style={{ minHeight: 50 }} value={addForm.objection} onChange={(e) => setAddForm({ ...addForm, objection: e.target.value })} /></Field>
        <Field label="未验证条件（可选）"><textarea className="textarea" style={{ minHeight: 50 }} value={addForm.unverified} onChange={(e) => setAddForm({ ...addForm, unverified: e.target.value })} /></Field>
      </Modal>
    </div>
  );
}

/* ================= 阶段一：文献调研 ================= */
function Stage1View({ pid, project, onProjectChange }) {
  const { toast, setRunning } = useApp();
  const [form, setForm] = useState({ topic: project.direction || '', fromYear: '', toYear: '', focus: '', targetCount: 20 });
  const [lits, setLits] = useState([]);
  const [report, setReport] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [strategy, setStrategy] = useState(null);
  const [busy, setBusy] = useState(null);
  const [analyzingId, setAnalyzingId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ title: '', authors: '', year: '', doi: '', url: '', abstract: '' });
  const jobsRef = useRef({});
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const [ls, arts] = await Promise.all([api.literatures.list(pid), api.artifacts.list(pid)]);
      setLits(ls);
      const reps = arts.filter((a) => a.kind === 'report').sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
      setReport(reps[0] || null);
      setQuestions(arts.filter((a) => a.kind === 'question' && a.stage === 1).map((q) => ({
        ...q, meta: (typeof q.meta === 'object' && q.meta !== null) ? q.meta : {}
      })));
    } catch (e) { toast(e.message, 'err'); }
  }, [pid]);

  useEffect(() => { load(); }, [load]);

  const runSearch = async () => {
    if (!form.topic.trim()) return toast('请填写研究主题', 'err');
    setBusy('search');
    setRunning({ stage: 1, label: '检索真实文献中' });
    try {
      const r = await api.workflow.stage1Run(pid, form);
      setStrategy(r);
      setLits(r.literatures);
      let note = `检索完成：新增 ${r.added} 篇（共 ${r.total} 篇），来自真实学术数据源`;
      if (r.sourceStatus && r.sourceStatus.openalex !== 'ok') {
        note += `；OpenAlex 暂不可用（${r.sourceStatus.openalex}），已自动使用 Crossref 结果`;
      }
      toast(note, 'ok');
      onProjectChange();
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(null); setRunning(null); }
  };

  const runReport = async () => {
    const jid = jobId();
    const ctrl = new AbortController();
    jobsRef.current[jid] = ctrl;
    setBusy('report');
    setRunning({ stage: 1, label: 'AI 撰写研究现状报告' });
    try {
      await api.workflow.stage1Report(pid, { topic: form.topic, focus: form.focus, jobId: jid }, ctrl.signal);
      await load();
      onProjectChange();
      toast('研究现状报告已生成，候选科学问题已进入待确认', 'ok');
    } catch (e) {
      if (e.name !== 'AbortError') toast(e.message, 'err');
    } finally {
      delete jobsRef.current[jid];
      setBusy(null);
      setRunning(null);
    }
  };

  const cancelBusy = () => {
    Object.values(jobsRef.current).forEach((c) => { try { c.abort(); } catch (e) {} });
    cancelJob(Object.keys(jobsRef.current)[0] || '');
    setBusy(null);
    setRunning(null);
  };

  const analyzeLit = async (id) => {
    const jid = jobId();
    const ctrl = new AbortController();
    jobsRef.current[jid] = ctrl;
    setAnalyzingId(id);
    setRunning({ stage: 1, label: 'AI 批判性分析中' });
    try {
      const r = await api.literatures.analyze(id, jid, ctrl.signal);
      toast('分析完成（摘要级，全文缺失时结论仅供预筛参考）', 'ok');
      await load();
    } catch (e) {
      if (e.name !== 'AbortError') toast(e.message, 'err');
    } finally {
      delete jobsRef.current[jid];
      setAnalyzingId(null);
      setRunning(null);
    }
  };

  const complete = async () => {
    try {
      await api.workflow.stage1Complete(pid);
      toast('文献调研完成，已进入研究论证（Step 2）', 'ok');
      onProjectChange();
      navigate(`/p/${pid}/stage/2`);
    } catch (e) { toast(e.message, 'err'); }
  };

  const addLit = async () => {
    if (!addForm.title.trim()) return toast('请填写文献标题', 'err');
    try {
      await api.literatures.add(pid, {
        title: addForm.title,
        authors: addForm.authors.split(/[;；,，]/).map((s) => s.trim()).filter(Boolean),
        year: addForm.year || null, doi: addForm.doi, url: addForm.url, abstract: addForm.abstract
      });
      setShowAdd(false);
      setAddForm({ title: '', authors: '', year: '', doi: '', url: '', abstract: '' });
      await load();
      toast('已手动添加文献', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  };

  const uploadPdfNew = async (file) => {
    try {
      const u = await api.uploads.upload(pid, file, 'fulltext');
      const r = await api.uploads.uploadFulltext((await api.literatures.add(pid, {
        title: file.name.replace(/\.pdf$/i, ''), source: 'PDF 上传', note: '由上传 PDF 创建，请编辑标题与元数据'
      })).id, file);
      toast(r.extracted ? `PDF 已导入（提取 ${r.chars} 字符）` : `PDF 已导入，但文本提取失败：${r.message || ''}`, r.extracted ? 'ok' : 'err');
      await load();
    } catch (e) { toast(e.message, 'err'); }
  };

  const guide1 = (() => {
    if (!lits.length) {
      return { steps: ['填写研究主题与年份范围', '点击「生成检索策略并检索」获取真实文献', '逐篇「AI 分析」/ 生成研究现状报告', '勾选核心论文并完成阶段'], current: 0 };
    }
    const sel = lits.filter((l) => l.selected === 1).length;
    if (!report) {
      return { steps: [`已获取 ${lits.length} 篇真实文献`, '可选：点击「生成研究现状报告」', '勾选至少 1 篇核心论文（点击文献左侧复选框）', '点击「完成并进入研究论证」'], current: 1 };
    }
    if (!sel) {
      return { steps: ['文献与报告已就绪', '勾选至少 1 篇核心论文（点击文献左侧复选框）', '点击「完成并进入研究论证」'], current: 1, warn: true };
    }
    return { steps: [`已选 ${sel} 篇核心论文`, '点击「完成并进入研究论证」进入 Step 2'], current: 0 };
  })();

  return (
    <div>
      <GuideBar steps={guide1.steps} current={guide1.current} warn={guide1.warn} />
      <div className="card card-pad">
        <div className="sec-label" style={{ marginBottom: 12 }}>检索设置</div>
        <div className="row wrap">
          <Field label="研究主题" className="grow" style={{ minWidth: 260 }}>
            <input className="input" value={form.topic} placeholder="如：机器学习预测高熵合金力学性能" onChange={(e) => setForm({ ...form, topic: e.target.value })} />
          </Field>
          <Field label="起始年份"><input className="input" style={{ width: 100 }} value={form.fromYear} placeholder="2018" onChange={(e) => setForm({ ...form, fromYear: e.target.value })} /></Field>
          <Field label="截止年份"><input className="input" style={{ width: 100 }} value={form.toYear} placeholder="2026" onChange={(e) => setForm({ ...form, toYear: e.target.value })} /></Field>
          <Field label="目标数量"><input className="input" style={{ width: 90 }} type="number" min={5} max={100} value={form.targetCount} onChange={(e) => setForm({ ...form, targetCount: Number(e.target.value) })} /></Field>
        </div>
        <Field label="研究重点（可选）"><input className="input" value={form.focus} placeholder="如：成分-工艺-性能映射、模型可解释性" onChange={(e) => setForm({ ...form, focus: e.target.value })} /></Field>
        <div className="toolbar">
          <Btn variant="primary" onClick={runSearch} disabled={busy === 'search'}>
            {busy === 'search' ? <Spinner size={13} /> : <Search size={14} />} 生成检索策略并检索
          </Btn>
          <Btn onClick={runReport} disabled={busy === 'report' || !lits.some((l) => l.abstract)}>
            {busy === 'report' ? <Spinner size={13} /> : <FileTextIcon size={14} />} 生成研究现状报告
          </Btn>
          <Btn onClick={() => fileRef.current && fileRef.current.click()}><Upload size={14} /> 上传 PDF</Btn>
          <input ref={fileRef} type="file" accept=".pdf,application/pdf" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files[0]; if (f) uploadPdfNew(f); e.target.value = ''; }} />
          <Btn variant="ghost" onClick={() => setShowAdd(true)}><Plus size={14} /> 手动添加文献</Btn>
          <div className="spacer" />
          <Btn variant="ok" onClick={complete} disabled={!lits.some((l) => l.selected === 1)}>
            完成并进入研究论证 <ArrowRight size={14} />
          </Btn>
        </div>
        {busy && (
          <div className="task-run">
            <div className="task-run-head" style={{ color: 'var(--text-3)', fontSize: 13 }}>
              <Spinner size={13} /> {busy === 'search' ? '正在生成检索策略并检索真实文献（OpenAlex/Crossref）…' : '模型正在撰写研究现状报告与候选科学问题…'}
              <Btn size="sm" variant="ghost" onClick={cancelBusy}><StopCircle size={13} /> 中止</Btn>
            </div>
            <div className="progress-line" />
          </div>
        )}
        {strategy && (
          <div className="card" style={{ background: 'var(--bg-elev)', padding: '10px 14px', marginTop: 6, fontSize: 12.5 }}>
            <div className="tiny" style={{ marginBottom: 4 }}>检索策略（{strategy.strategySource === 'ai' ? 'AI 生成' : '内置策略'}）</div>
            <div className="muted">主检索式：{strategy.strategy.mainQuery}</div>
            <div className="muted">子检索式：{strategy.strategy.subQueries.join(' ｜ ')}</div>
            {strategy.strategy.note && <div className="muted">说明：{strategy.strategy.note}</div>}
            {strategy.sourceStatus && strategy.sourceStatus.openalex !== 'ok' && (
              <div className="muted" style={{ color: 'var(--warn)' }}>⚠ OpenAlex 当前不可用（{strategy.sourceStatus.openalex}），本次结果来自 Crossref。可在稍后重试以获取摘要更全的结果。</div>
            )}
          </div>
        )}
      </div>

      {report && (
        <div className="card card-pad" style={{ marginTop: 14 }}>
          <div className="row" style={{ marginBottom: 8 }}>
            <div className="grow sec-label">研究现状报告</div>
            <span className="tiny">{new Date(report.updated_at).toLocaleString('zh-CN')}</span>
          </div>
          <Markdown text={report.content} />
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        <div className="row" style={{ marginBottom: 8 }}>
          <div className="grow sec-label">文献证据库 · {lits.length} 篇</div>
          <span className="tiny">勾选复选框 → 选为核心论文</span>
        </div>
        {!lits.length && <EmptyState icon={<BookOpenCheck size={22} />} text="暂无文献。点击「生成检索策略并检索」从真实学术数据源获取。" />}
        {lits.map((l) => (
          <LitRow key={l.id} lit={l} pid={pid} onChanged={load} onAnalyze={analyzeLit} analyzing={analyzingId === l.id} />
        ))}
      </div>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="手动添加文献"
        footer={<>
          <Btn onClick={() => setShowAdd(false)}>取消</Btn>
          <Btn variant="primary" onClick={addLit}>添加</Btn>
        </>}>
        <Field label="标题 *"><input className="input" value={addForm.title} onChange={(e) => setAddForm({ ...addForm, title: e.target.value })} /></Field>
        <Field label="作者（用逗号分隔）"><input className="input" value={addForm.authors} onChange={(e) => setAddForm({ ...addForm, authors: e.target.value })} /></Field>
        <div className="row">
          <Field label="年份" className="grow"><input className="input" value={addForm.year} onChange={(e) => setAddForm({ ...addForm, year: e.target.value })} /></Field>
          <Field label="DOI" className="grow"><input className="input" value={addForm.doi} onChange={(e) => setAddForm({ ...addForm, doi: e.target.value })} /></Field>
        </div>
        <Field label="来源链接"><input className="input" value={addForm.url} onChange={(e) => setAddForm({ ...addForm, url: e.target.value })} /></Field>
        <Field label="摘要"><textarea className="textarea" value={addForm.abstract} onChange={(e) => setAddForm({ ...addForm, abstract: e.target.value })} /></Field>
      </Modal>
    </div>
  );
}

/* ================= 可编辑文献对比矩阵 ================= */
function parseTable(md) {
  const lines = String(md || '').split('\n');
  let start = -1, end = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('|')) { if (start < 0) start = i; end = i; }
    else if (start >= 0) break;
  }
  if (start < 0) return null;
  const block = lines.slice(start, end + 1);
  if (block.length < 2) return null;
  const splitRow = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  const header = splitRow(block[0]);
  if (header.length < 2) return null;
  const body = block.slice(2).filter((l) => l.trim().startsWith('|')).map(splitRow);
  const cols = header.slice(1).map((label, i) => ({ key: 'lit-' + i, label: label || `文献${i + 1}` }));
  const rows = body.map((r) => ({ dimension: (r[0] || '').trim(), cells: r.slice(1).map((c) => c.trim()) }));
  return { cols, rows };
}

function EditableMatrix({ artifact, lits, onChanged }) {
  const { toast } = useApp();
  const m = (artifact.meta && artifact.meta.matrix) || parseTable(artifact.content);
  const [edit, setEdit] = useState(null);

  const colLabel = (c, i) => {
    if (c.label && c.label !== `文献${i + 1}`) return c.label;
    const lit = lits[i];
    if (!lit) return c.label || `文献${i + 1}`;
    const a = Array.isArray(lit.authors) && lit.authors.length ? lit.authors[0] : '';
    const name = String(a || '').split(' ').pop() || '';
    return `文献${i + 1}${name || lit.year ? ` (${name || lit.year})` : ''}`;
  };

  const saveCell = async () => {
    if (!edit) return;
    try {
      await api.artifacts.matrixCell(artifact.id, { rowIndex: edit.row, colIndex: edit.col, text: edit.text });
      setEdit(null);
      onChanged();
      toast('矩阵单元格已更新', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  };

  if (!m) {
    return (
      <div className="card card-pad" style={{ marginTop: 14 }}>
        <div className="row" style={{ marginBottom: 8 }}>
          <div className="grow sec-label">文献对比矩阵与研究论证</div>
          <span className="tiny">{new Date(artifact.updated_at).toLocaleString('zh-CN')}</span>
        </div>
        <Markdown text={artifact.content} />
      </div>
    );
  }

  return (
    <div className="card card-pad" style={{ marginTop: 14 }}>
      <div className="row" style={{ marginBottom: 8 }}>
        <div className="grow sec-label">文献对比矩阵与研究论证</div>
        <span className="tiny">点击单元格可编辑「待补充」内容 · {new Date(artifact.updated_at).toLocaleString('zh-CN')}</span>
      </div>
      <div className="matrix-wrap">
        <table className="matrix">
          <thead>
            <tr>
              <th className="matrix-dim">维度</th>
              {m.cols.map((c, i) => <th key={c.key}>{colLabel(c, i)}</th>)}
            </tr>
          </thead>
          <tbody>
            {m.rows.map((r, ri) => (
              <tr key={ri}>
                <td className="matrix-dim">{r.dimension}</td>
                {r.cells.map((c, ci) => (
                  <td
                    key={ci}
                    className={`matrix-cell ${(!c || /^待补充/.test(c)) ? 'pending' : ''}`}
                    onClick={() => setEdit({ row: ri, col: ci, text: c || '' })}
                    title="点击编辑"
                  >
                    {c || '待补充'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="tiny muted" style={{ marginTop: 8 }}>「待补充」表示该信息当前缺失（仅元数据/综述类文献），可手动补充，或上传全文后重新分析。</div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title="编辑矩阵单元格"
        footer={<>
          <Btn onClick={() => setEdit(null)}>取消</Btn>
          <Btn variant="primary" onClick={saveCell}>保存</Btn>
        </>}>
        <Field label="内容"><textarea className="textarea" style={{ minHeight: 90 }} value={edit ? edit.text : ''} onChange={(e) => setEdit({ ...edit, text: e.target.value })} /></Field>
      </Modal>
    </div>
  );
}

/* ================= 阶段二：研究论证 ================= */
function Stage2View({ pid, project, onProjectChange }) {
  const { toast, setRunning } = useApp();
  const [lits, setLits] = useState([]);
  const [matrix, setMatrix] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [busy, setBusy] = useState(null);
  const [analyzingId, setAnalyzingId] = useState(null);
  const jobsRef = useRef({});
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const [ls, arts] = await Promise.all([api.literatures.list(pid), api.artifacts.list(pid)]);
      setLits(ls.filter((l) => l.selected === 1));
      const mx = arts.filter((a) => a.kind === 'matrix').sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
      setMatrix(mx[0] || null);
      setQuestions(arts.filter((a) => a.kind === 'question' && a.stage === 2).map((q) => ({
        ...q, meta: (typeof q.meta === 'object' && q.meta !== null) ? q.meta : {}
      })));
    } catch (e) { toast(e.message, 'err'); }
  }, [pid]);

  useEffect(() => { load(); }, [load]);

  const analyzeLit = async (id) => {
    const jid = jobId();
    const ctrl = new AbortController();
    jobsRef.current[jid] = ctrl;
    setAnalyzingId(id);
    setRunning({ stage: 2, label: 'AI 批判性分析中' });
    try {
      await api.literatures.analyze(id, jid, ctrl.signal);
      toast('批判性分析完成', 'ok');
      await load();
    } catch (e) {
      if (e.name !== 'AbortError') toast(e.message, 'err');
    } finally {
      delete jobsRef.current[jid];
      setAnalyzingId(null);
      setRunning(null);
    }
  };

  const runCross = async () => {
    const jid = jobId();
    const ctrl = new AbortController();
    jobsRef.current[jid] = ctrl;
    setBusy('cross');
    setRunning({ stage: 2, label: 'AI 跨论文论证中' });
    try {
      await api.workflow.stage2Cross(pid, jid, ctrl.signal);
      await load();
      onProjectChange();
      toast('对比矩阵与候选创新点已生成', 'ok');
    } catch (e) {
      if (e.name !== 'AbortError') toast(e.message, 'err');
    } finally {
      delete jobsRef.current[jid];
      setBusy(null);
      setRunning(null);
    }
  };

  const cancelBusy = () => {
    const k = Object.keys(jobsRef.current)[0];
    if (k) { try { jobsRef.current[k].abort(); } catch (e) {} cancelJob(k); }
    setBusy(null);
    setRunning(null);
  };

  const complete = async () => {
    try {
      await api.workflow.stage2Complete(pid);
      toast('研究论证完成，已进入申报写作（Step 3）', 'ok');
      onProjectChange();
      navigate(`/p/${pid}/stage/3`);
    } catch (e) { toast(e.message, 'err'); }
  };

  const uploadPdfNew = async (file) => {
    try {
      const lit = await api.literatures.add(pid, { title: file.name.replace(/\.pdf$/i, ''), source: 'PDF 上传', note: '由上传 PDF 创建，请编辑元数据' });
      const r = await api.uploads.uploadFulltext(lit.id, file);
      toast(r.extracted ? `PDF 已导入并提取全文（${r.chars} 字符）` : `PDF 已导入，文本提取失败：${r.message || ''}`, r.extracted ? 'ok' : 'err');
      await load();
    } catch (e) { toast(e.message, 'err'); }
  };

  const confirmedCount = questions.filter((q) => q.confirmed === 1).length;
  const guide2 = (() => {
    if (!lits.length) {
      return { steps: ['当前没有核心论文', '返回阶段一，勾选文献并完成文献调研后进入本阶段'], current: 0, warn: true };
    }
    if (!matrix) {
      return { steps: ['（可选）对核心论文逐篇点击「AI 分析」', '点击「跨论文分析」生成对比矩阵与候选科学问题', '审核并「确认」候选科学问题（至少 1 项）', '点击「完成并进入申报写作」'], current: 1 };
    }
    if (!confirmedCount) {
      return { steps: ['对比矩阵已生成', '在下方「候选科学问题」中点选「确认」（至少 1 项）', '再点击「完成并进入申报写作」'], current: 1, warn: true };
    }
    return { steps: [`已确认 ${confirmedCount} 个科学问题`, '点击「完成并进入申报写作」进入 Step 3'], current: 0 };
  })();

  return (
    <div>
      <GuideBar steps={guide2.steps} current={guide2.current} warn={guide2.warn} />
      <div className="card card-pad">
        <div className="sec-label" style={{ marginBottom: 8 }}>核心论文（来自阶段一确认）· {lits.length} 篇</div>
        {!lits.length && <EmptyState icon={<PenTool size={22} />} text="暂无核心论文。请返回阶段一勾选文献后进入。" />}
        {lits.map((l) => (
          <LitRow key={l.id} lit={l} pid={pid} onChanged={load} onAnalyze={analyzeLit} analyzing={analyzingId === l.id} />
        ))}
        <div className="toolbar">
          <Btn variant="primary" onClick={runCross} disabled={busy === 'cross' || !lits.length}>
            {busy === 'cross' ? <Spinner size={13} /> : <RefreshCw size={14} />} 跨论文分析（对比矩阵 + 候选创新）
          </Btn>
          <Btn onClick={() => fileRef.current && fileRef.current.click()}><Upload size={14} /> 上传更多 PDF</Btn>
          <input ref={fileRef} type="file" accept=".pdf,application/pdf" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files[0]; if (f) uploadPdfNew(f); e.target.value = ''; }} />
          <div className="spacer" />
          <Btn variant="ok" onClick={complete} disabled={!confirmedCount} title={!confirmedCount ? '请先确认至少 1 个候选科学问题' : ''}>
            完成并进入申报写作 <ArrowRight size={14} />
          </Btn>
        </div>
        {!confirmedCount && questions.length > 0 && (
          <div className="hint-block warn">
            尚未确认科学问题：请在下方的「候选科学问题」列表中点击「确认」，至少确认 1 项后才能进入申报写作。
          </div>
        )}
        {!confirmedCount && !questions.length && matrix && (
          <div className="hint-block warn">
            跨论文分析未解析出候选问题：请点击「手动添加」补充研究问题并「确认」后，再进入申报写作。
          </div>
        )}
        {busy === 'cross' && (
          <div className="task-run">
            <div className="task-run-head" style={{ color: 'var(--text-3)', fontSize: 13 }}>
              <Spinner size={13} /> 模型正在对核心论文进行跨论文论证（对比矩阵 + 候选科学问题）…
              <Btn size="sm" variant="ghost" onClick={cancelBusy}><StopCircle size={13} /> 中止</Btn>
            </div>
            <div className="progress-line" />
          </div>
        )}
      </div>

      {matrix && <EditableMatrix artifact={matrix} lits={lits} onChanged={load} />}

      <QuestionList pid={pid} questions={questions} onChanged={load} />
    </div>
  );
}

/* ================= 阶段三：申报写作 ================= */
function Stage3View({ pid, project, onProjectChange }) {
  const { toast, setRunning } = useApp();
  const [data, setData] = useState(null);
  const [chapterId, setChapterId] = useState(null);
  const [content, setContent] = useState('');
  const [mode, setMode] = useState('edit');
  const [stream, setStream] = useState(null);
  const [busyCheck, setBusyCheck] = useState(false);
  const [checkResult, setCheckResult] = useState(null);
  const [versions, setVersions] = useState(null);
  const [showCite, setShowCite] = useState(false);
  const [materialFile, setMaterialFile] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatLog, setChatLog] = useState([]);
  const [citedIds, setCitedIds] = useState(() => new Set());
  const taRef = useRef(null);
  const jobsRef = useRef({});

  const load = useCallback(async () => {
    try {
      const d = await api.workflow.stage3Data(pid);
      setData(d);
      if (d.chapters.length && !d.chapters.find((c) => c.meta.chapterId === chapterId)) {
        setChapterId(d.chapters[0].meta.chapterId);
        setContent(d.chapters[0].content || '');
      } else if (d.chapters.length) {
        const cur = d.chapters.find((c) => c.meta.chapterId === chapterId);
        if (cur) setContent(cur.content || '');
      } else if (d.template.structure.length && !chapterId) {
        setChapterId(d.template.structure[0].id);
        setContent('');
      }
    } catch (e) { toast(e.message, 'err'); }
  }, [pid]);

  useEffect(() => { load(); }, [load]);

  const chapterArtifact = useMemo(() => {
    if (!data) return null;
    return data.chapters.find((c) => c.meta.chapterId === chapterId) || null;
  }, [data, chapterId]);

  const selectChapter = (id) => {
    const art = data.chapters.find((c) => c.meta.chapterId === id);
    setChapterId(id);
    setContent(art ? art.content || '' : '');
  };

  const stopStream = () => {
    if (stream) {
      try { cancelJob(stream.jid); } catch (e) {}
      if (stream.ctrl) { try { stream.ctrl.abort(); } catch (e) {} }
    }
  };

  const generate = async () => {
    if (!chapterId) return;
    if (stream) stopStream();
    const jid = jobId();
    const ctrl = new AbortController();
    setStream({ active: true, jid, ctrl, buffer: '', title: `正在生成「${chapterTitle()}」…` });
    setRunning({ stage: 3, label: `AI 生成「${chapterTitle()}」` });
    try {
      const r = await streamEndpoint(`/api/projects/${pid}/stage3/generate`, { chapterId, jobId: jid }, {
        signal: ctrl.signal,
        onDelta: (d, text) => setStream((s) => ({ ...s, buffer: text }))
      });
      setContent(r.artifact ? r.artifact.content || '' : '');
      await load();
      onProjectChange();
      toast(r.aborted ? '生成已中止（已保存部分内容）' : '章节已生成', r.aborted ? 'info' : 'ok');
    } catch (e) {
      if (e.name !== 'AbortError') toast(e.message, 'err');
    } finally {
      setStream(null);
      setRunning(null);
    }
  };

  const assist = async (action, label) => {
    if (!chapterId) return;
    if (stream) stopStream();
    const jid = jobId();
    const ctrl = new AbortController();
    setStream({ active: true, jid, ctrl, buffer: '', title: `${label}中…` });
    setRunning({ stage: 3, label: `AI ${label}中` });
    try {
      const r = await streamEndpoint(`/api/projects/${pid}/stage3/assist`, { chapterId, action, jobId: jid }, {
        signal: ctrl.signal,
        onDelta: (d, text) => setStream((s) => ({ ...s, buffer: text }))
      });
      if (r.aborted) toast('已中止', 'info');
    } catch (e) {
      if (e.name !== 'AbortError') toast(e.message, 'err');
    } finally {
      setStream((s) => (s ? { ...s, active: false } : null));
      setRunning(null);
    }
  };

  const applyStream = () => {
    if (stream && stream.buffer) setContent(stream.buffer);
    setStream(null);
    toast('已应用到编辑区（记得保存）', 'ok');
  };

  const chatSend = async () => {
    const text = chatInput.trim();
    if (!text || stream || !chapterId) return;
    const jid = jobId();
    const ctrl = new AbortController();
    setChatLog((l) => [...l, { role: 'user', text }, { role: 'ai', text: '' }]);
    setChatInput('');
    setStream({ active: true, jid, ctrl, buffer: '', title: `AI 按指令修改「${chapterTitle()}」…` });
    setRunning({ stage: 3, label: 'AI 对话改稿中' });
    try {
      await streamEndpoint(`/api/projects/${pid}/stage3/assist`, { chapterId, action: 'free', instruction: text, jobId: jid }, {
        signal: ctrl.signal,
        onDelta: (d, text2) => {
          setStream((s) => ({ ...s, buffer: text2 }));
          setChatLog((l) => { const c = [...l]; c[c.length - 1] = { ...c[c.length - 1], text: text2 }; return c; });
        }
      });
    } catch (e) {
      if (e.name !== 'AbortError') toast(e.message, 'err');
    } finally {
      setStream(null);
      setRunning(null);
    }
  };

  const applyChat = (msg) => {
    setContent(msg.text);
    setMode('edit');
    toast('已应用到编辑区，记得点「保存」', 'ok');
  };

  const chapterTitle = () => {
    if (!data) return '';
    const c = data.template.structure.find((x) => x.id === chapterId);
    return c ? c.title : '';
  };

  const save = async () => {
    if (!chapterId) return;
    try {
      await api.workflow.stage3Save(pid, { chapterId, content });
      await load();
      toast('已保存', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  };

  const saveVersion = async () => {
    if (!chapterId) return;
    try {
      await api.workflow.stage3Version(pid, { chapterId });
      await load();
      toast('已保存版本快照', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  };

  const openVersions = async () => {
    if (!chapterArtifact) return toast('该章节暂无内容', 'err');
    try {
      const v = await api.artifacts.versions(chapterArtifact.id);
      setVersions(v);
    } catch (e) { toast(e.message, 'err'); }
  };

  const restoreVersion = async (version) => {
    if (!chapterArtifact) return;
    try {
      await api.artifacts.restore(chapterArtifact.id, version);
      setVersions(null);
      await load();
      setContent('');
      const d = await api.workflow.stage3Data(pid);
      const cur = d.chapters.find((c) => c.meta.chapterId === chapterId);
      setContent(cur ? cur.content : '');
      toast('已恢复到版本 ' + version, 'ok');
    } catch (e) { toast(e.message, 'err'); }
  };

  const runCheck = async () => {
    const jid = jobId();
    const ctrl = new AbortController();
    jobsRef.current[jid] = ctrl;
    setBusyCheck(true);
    setRunning({ stage: 3, label: '全章节逻辑一致性检查中' });
    try {
      const r = await api.workflow.stage3Check(pid, jid, ctrl.signal);
      setCheckResult(r.content);
      await load();
    } catch (e) {
      if (e.name !== 'AbortError') toast(e.message, 'err');
    } finally {
      delete jobsRef.current[jid];
      setBusyCheck(false);
      setRunning(null);
    }
  };

  const insertCitation = (lit, idx) => {
    const ta = taRef.current;
    const cite = `[${idx + 1}]`;
    const pos = ta ? ta.selectionStart : content.length;
    const next = content.slice(0, pos) + cite + content.slice(pos);
    setContent(next);
    setCitedIds((s) => new Set(s).add(lit.id));
    setTimeout(() => { if (ta) { ta.focus(); ta.selectionStart = ta.selectionEnd = pos + cite.length; } }, 30);
  };

  const changeAiMode = async (v) => {
    try {
      await api.projects.update(pid, { ai_mode: v });
      onProjectChange();
      toast(v === 'draft_allowed' ? '已切换为「允许 AI 起草」' : '已切换为「仅辅助论证材料」', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  };

  const uploadMaterial = async (file) => {
    try {
      const u = await api.uploads.upload(pid, file, 'material');
      toast(u.text_path ? '项目资料已上传并提取文本（将作为写作上下文）' : '项目资料已上传', 'ok');
      await load();
    } catch (e) { toast(e.message, 'err'); }
  };

  if (!data) return <div className="muted">加载申报写作区…</div>;

  const restricted = project.ai_mode !== 'draft_allowed';

  const guide3 = (() => {
    const chapters = data.chapters;
    const unsaved = chapters.filter((c) => !c.content || !c.content.trim());
    if (!chapters.length) {
      return restricted
        ? { steps: ['选择左侧章节', '生成章节提纲与论证材料（AI 不代写正文）', '按提纲撰写人工稿件', '保存并运行逻辑一致性检查'], current: 0 }
        : { steps: ['选择左侧章节', '生成章节草稿', '人工核验并修改', '保存并运行逻辑一致性检查'], current: 0 };
    }
    if (unsaved.length) {
      return restricted
        ? { steps: [`完善「${unsaved[0].title}」提纲/论证材料`, '撰写人工稿件', '保存版本', '运行逻辑一致性检查'], current: 0 }
        : { steps: [`生成「${unsaved[0].title}」草稿`, '人工核验并修改', '保存版本', '运行逻辑一致性检查'], current: 0 };
    }
    const hasCheck = !!(data.check && data.check.content && data.check.content.trim());
    const hasCitations = data.chapters.some((c) => /\[\d+\]/.test(c.content || ''));
    return {
      steps: [
        '所有章节已有内容',
        hasCheck ? '运行「全章节逻辑一致性检查」（已完成）' : '运行「全章节逻辑一致性检查」',
        hasCitations ? '插入文献引用并完善（已插入）' : '插入文献引用并完善',
        '点击「导出成果」生成 Word/Markdown'
      ],
      current: !hasCheck ? 1 : (hasCitations ? 3 : 2)
    };
  })();

  return (
    <div>
      <GuideBar steps={guide3.steps} current={guide3.current} />
      <div className="card card-pad">
        <div className="row wrap">
          <div className="grow">
            <div className="sec-label" style={{ marginBottom: 4 }}>AI 使用模式（按项目申报规定切换）</div>
            <div className="muted" style={{ maxWidth: 520 }}>
              {restricted
                ? '当前：仅辅助论证材料。AI 只生成章节提纲、证据整理与审校意见，不生成可直接提交的完整申请书。'
                : '当前：允许 AI 起草。AI 可生成分章节草稿，仍须人工核验全部事实。'}
            </div>
          </div>
          <select className="input" style={{ width: 230 }} value={project.ai_mode} onChange={(e) => changeAiMode(e.target.value)}>
            <option value="restricted">仅辅助论证材料（提纲/证据/审校）</option>
            <option value="draft_allowed">允许 AI 起草（分章节草稿）</option>
          </select>
        </div>
      </div>

      <div style={{ marginTop: 14 }} className="card card-pad">
        <div className="sec-label" style={{ marginBottom: 10 }}>章节结构（{data.template.name}）</div>
        <div className="chip-nav">
          {data.template.structure.map((c) => {
            const art = data.chapters.find((x) => x.meta.chapterId === c.id);
            return (
              <span key={c.id} className={`chip ${chapterId === c.id ? 'active' : ''}`} onClick={() => selectChapter(c.id)} title={c.guide}>
                {c.title}{art && art.content ? ' ✓' : ''}
              </span>
            );
          })}
        </div>

        <div className="editor-toolbar">
          <Btn variant="primary" size="sm" onClick={generate} disabled={!!stream || !chapterId}>
            <Sparkles size={13} /> {restricted ? '生成章节提纲与论证材料' : '生成章节草稿'}
          </Btn>
          <Btn size="sm" onClick={() => assist('expand', '扩写')} disabled={!!stream || !content}><Plus size={13} /> 扩写</Btn>
          <Btn size="sm" onClick={() => assist('condense', '精简')} disabled={!!stream || !content}><RefreshCw size={13} /> 精简</Btn>
          <Btn size="sm" onClick={() => assist('polish', '修改润色')} disabled={!!stream || !content}><Pencil size={13} /> 修改润色</Btn>
          <Btn size="sm" onClick={() => assist('continue', '续写')} disabled={!!stream || !content}>续写</Btn>
          <Btn size="sm" onClick={() => assist('check', '章节检查')} disabled={!!stream || !content}><ClipboardList size={13} /> 检查本章</Btn>
          <Btn size="sm" variant={chatOpen ? 'primary' : 'ghost'} onClick={() => setChatOpen((v) => !v)}><MessageSquare size={13} /> AI 对话改稿</Btn>
          <Btn size="sm" onClick={() => setShowCite(true)} disabled={!data.literatures.length}><BookOpenCheck size={13} /> 插入引用</Btn>
          <div className="spacer" />
          <Btn size="sm" variant="primary" onClick={() => download(`/api/projects/${pid}/export?format=docx`, '')}><FileTextIcon size={13} /> 导出 Word</Btn>
          <Btn size="sm" variant="ghost" onClick={() => download(`/api/projects/${pid}/export?format=md`, '')}><FileText size={13} /> 导出 Markdown</Btn>
          <Btn size="sm" onClick={save}><Download size={13} /> 保存</Btn>
          <Btn size="sm" variant="ghost" onClick={saveVersion}><History size={13} /> 保存版本</Btn>
          <Btn size="sm" variant="ghost" onClick={openVersions}><History size={13} /> 版本历史</Btn>
        </div>
        <div className="tiny" style={{ marginBottom: 8 }}>
          {restricted ? '本章输出为提纲与论证材料；请据此撰写人工稿件。' : (data.template.structure.find((c) => c.id === chapterId) || {}).guide}
        </div>

        {stream && (
          <div className="stream-panel" style={{ marginBottom: 10 }}>
            <div className="row" style={{ marginBottom: 8 }}>
              {stream.active ? <Spinner size={13} /> : <CheckCircle2 size={13} style={{ color: 'var(--ok)' }} />}
              <span className="muted">{stream.active ? stream.title : '已完成，可「应用」到编辑区或「放弃」'}</span>
              <div className="spacer" />
              {stream.active && <Btn size="sm" variant="ghost" onClick={stopStream}><StopCircle size={13} /> 停止</Btn>}
              {!stream.active && <Btn size="sm" variant="primary" onClick={applyStream}>应用</Btn>}
              {!stream.active && <Btn size="sm" variant="ghost" onClick={() => setStream(null)}><X size={13} /> 放弃</Btn>}
            </div>
            <div className="progress-line" style={{ marginBottom: 8 }} />
            {stream.buffer || '…'}
          </div>
        )}

        {chatOpen && (
          <div className="card" style={{ marginBottom: 10, padding: 12, background: 'var(--card-2)' }}>
            <div className="row" style={{ marginBottom: 8 }}>
              <div className="grow" style={{ fontWeight: 550 }}>AI 对话改稿 <span className="tiny muted">· 针对「{chapterTitle()}」当前内容</span></div>
              <Btn size="sm" variant="ghost" onClick={() => setChatOpen(false)}><X size={13} /></Btn>
            </div>
            <div style={{ maxHeight: 260, overflowY: 'auto', marginBottom: 8 }}>
              {!chatLog.length && <div className="tiny muted" style={{ padding: '8px 0' }}>输入指令，例如：「把第二段写得更学术」「补充实验安排说明」「按照刚才检查报告第 2 条修改本章」。AI 会输出修改后的完整章节，确认后再应用。</div>}
              {chatLog.map((m, i) => (
                <div key={i} style={{ marginBottom: 8, textAlign: m.role === 'user' ? 'right' : 'left' }}>
                  <div className="tiny muted" style={{ marginBottom: 2 }}>{m.role === 'user' ? '我' : 'AI'}</div>
                  <div style={{ display: 'inline-block', maxWidth: '88%', padding: '8px 10px', borderRadius: 8, background: m.role === 'user' ? '#2a3a52' : 'var(--border)', textAlign: 'left', whiteSpace: 'pre-wrap', fontSize: 13 }}>
                    {m.text || (stream && i === chatLog.length - 1 ? '…' : '')}
                  </div>
                  {m.role === 'ai' && m.text && !stream && (
                    <div><Btn size="sm" variant="primary" onClick={() => applyChat(m)}>应用此版本</Btn></div>
                  )}
                </div>
              ))}
            </div>
            <div className="row">
              <input className="input grow" placeholder="输入对本章的修改指令…" value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') chatSend(); }} disabled={!!stream} />
              <Btn size="sm" variant="primary" onClick={chatSend} disabled={!!stream || !chatInput.trim()}><Send size={13} /> 发送</Btn>
            </div>
          </div>
        )}

        <div className="editor-area">
          {mode === 'preview' ? (
            <div>
              <div className="row" style={{ marginBottom: 8 }}>
                <span className="tiny muted">预览模式 · 点击右侧按钮可直接修改正文</span>
                <div className="spacer" />
                <Btn size="sm" variant="primary" onClick={() => setMode('edit')}><Pencil size={13} /> 手动编辑本章</Btn>
              </div>
              <Markdown text={content || '*（空）*'} />
            </div>
          ) : (
            <textarea ref={taRef} value={content} onChange={(e) => setContent(e.target.value)} placeholder={restricted ? '可直接在此手动修改草稿：粘贴你的想法、补充段落、调整措辞，完成后点「保存」…' : '可直接在此手动修改草稿：粘贴你的想法、补充段落、调整措辞，完成后点「保存」…'} />
          )}
        </div>
        <div className="toolbar">
          <Btn size="sm" variant="ghost" onClick={() => setMode(mode === 'edit' ? 'preview' : 'edit')}>{mode === 'edit' ? '预览渲染' : '返回编辑'}</Btn>
          <Btn size="sm" variant="ghost" onClick={runCheck} disabled={busyCheck || !data.chapters.length}>
            {busyCheck ? <Spinner size={13} /> : <ClipboardList size={13} />} 全章节逻辑一致性检查
          </Btn>
        </div>
      </div>

      <div className="card card-pad" style={{ marginTop: 14 }}>
        <div className="row">
          <div className="grow sec-label">项目资料（上传后作为 AI 写作的真实依据，缺失信息 AI 必须写“待补充”）</div>
          <Btn size="sm" onClick={() => materialFile && materialFile.click()}>
            <Upload size={13} /> 上传资料
          </Btn>
          <input ref={setMaterialFile} type="file" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files[0]; if (f) uploadMaterial(f); e.target.value = ''; }} />
        </div>
        {!data.materials.length && <EmptyState icon={<FileTextIcon size={22} />} text="暂无项目资料。上传研究基础、实验条件、经费与团队材料。" />}
        {data.materials.map((m) => (
          <div key={m.id} className="ctx-item">
            <span className="grow txt">{m.filename} <span className="tiny">（{Math.round(m.size / 1024)} KB{m.text_path ? '，已提取文本' : ''}）</span></span>
            <Btn size="sm" variant="ghost" onClick={() => download(api.uploads.downloadUrl(m.id), m.filename)}><Download size={13} /> 下载</Btn>
          </div>
        ))}
      </div>

      <QuestionList pid={pid} questions={data.questions} onChanged={load} />

      <Modal open={showCite} onClose={() => setShowCite(false)} title="插入文献引用">
        {!data.literatures.length && <EmptyState text="暂无可引用的已确认文献。返回阶段一/二确认文献。" />}
        {data.literatures.map((l, i) => {
          const cited = citedIds.has(l.id);
          return (
            <div key={l.id} className="ctx-item" style={{ cursor: 'pointer', opacity: cited ? 0.65 : 1 }} onClick={() => insertCitation(l, i)}>
              <span className="txt">[{i + 1}] {l.title}（{(l.authors || []).slice(0, 3).join('、') || '作者未知'}{l.year ? ', ' + l.year : ''}）</span>
              {cited ? <CheckCircle2 size={13} style={{ color: 'var(--ok)', flex: 'none' }} /> : <Plus size={13} />}
            </div>
          );
        })}
        <div className="row" style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <div className="grow tiny muted">{citedIds.size ? `已插入 ${citedIds.size} 条引用，可继续选择，完成后点「完成」。` : '点击条目即在光标处插入引用标记；可连续多选。'}</div>
          <Btn size="sm" variant="primary" onClick={() => setShowCite(false)}>完成</Btn>
        </div>
      </Modal>

      <Modal open={!!versions} onClose={() => setVersions(null)} title="版本历史" width="620px">
        {versions && versions.versions.length === 0 && <EmptyState text="暂无版本快照。编辑后点击「保存版本」。" />}
        {versions && versions.versions.map((v) => (
          <div key={v.version} className="ctx-item">
            <span className="grow txt">版本 v{v.version} · {new Date(v.created_at).toLocaleString('zh-CN')}</span>
            <Btn size="sm" onClick={() => restoreVersion(v.version)}><RefreshCw size={13} /> 恢复</Btn>
          </div>
        ))}
      </Modal>

      <Modal open={!!checkResult} onClose={() => setCheckResult(null)} title="全章节逻辑一致性检查" width="680px">
        <Markdown text={checkResult} />
        <div className="row" style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <div className="grow tiny muted">如何修改：可直接手动编辑章节，或把问题交给 AI 对话改稿。</div>
          <Btn size="sm" variant="primary" onClick={() => { setChatInput(`请根据上面的逻辑一致性检查结果，修改本章中相关问题：`); setChatOpen(true); setCheckResult(null); }}><MessageSquare size={13} /> 交给 AI 修改本章</Btn>
        </div>
      </Modal>
    </div>
  );
}

/* ================= 上下文面板 ================= */
function ContextPanel({ pid, stage, open }) {
  const { toast } = useApp();
  const [lits, setLits] = useState([]);
  const [todos, setTodos] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [newTodo, setNewTodo] = useState('');

  const load = useCallback(async () => {
    try {
      const [ls, ts, arts] = await Promise.all([api.literatures.list(pid), api.todos.list(pid), api.artifacts.list(pid)]);
      setLits(ls.filter((l) => l.selected === 1));
      setTodos(ts);
      setQuestions(arts.filter((a) => a.kind === 'question' && a.confirmed === 1).map((q) => ({
        ...q, meta: (typeof q.meta === 'object' && q.meta !== null) ? q.meta : {}
      })));
    } catch (e) { toast(e.message, 'err'); }
  }, [pid]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const toggleTodo = async (t, done) => {
    try { await api.todos.update(pid, t.id, done ? 'done' : 'pending'); load(); } catch (e) { toast(e.message, 'err'); }
  };
  const addTodo = async () => {
    if (!newTodo.trim()) return;
    try { await api.todos.add(pid, { text: newTodo.trim(), stage }); setNewTodo(''); load(); toast('已添加待确认事项', 'ok'); } catch (e) { toast(e.message, 'err'); }
  };

  return (
    <div className={`ws-context ${!open ? 'collapsed' : ''}`}>
      <div className="ctx-block">
        <span className="sec-label">文献来源 · {lits.length}</span>
        {!lits.length && <div className="tiny" style={{ marginTop: 6 }}>暂无已确认文献</div>}
        {lits.map((l) => (
          <div key={l.id} className="ctx-item">
            <span className="txt">{l.title}</span>
            <a href={l.url || '#'} target="_blank" rel="noopener noreferrer" onClick={(e) => { if (!l.url) e.preventDefault(); }}><ExternalLink size={12} /></a>
          </div>
        ))}
      </div>
      <div className="ctx-block">
        <span className="sec-label">相关证据</span>
        {lits.filter((l) => l.analysis).slice(0, 6).map((l) => (
          <div key={l.id} className="ctx-item">
            <span className="txt" style={{ fontSize: 12 }}>{l.title.slice(0, 40)}… {l.analysis.slice(0, 110)}…</span>
          </div>
        ))}
        {!lits.some((l) => l.analysis) && <div className="tiny" style={{ marginTop: 6 }}>运行 AI 分析后在此显示证据摘要</div>}
      </div>
      <div className="ctx-block">
        <span className="sec-label">待确认事项 · {todos.filter((t) => t.status === 'pending').length}</span>
        {todos.map((t) => (
          <div key={t.id} className="ctx-item">
            <input type="checkbox" className="checkbox" checked={t.status === 'done'} onChange={(e) => toggleTodo(t, e.target.checked)} />
            <span className="txt" style={{ textDecoration: t.status === 'done' ? 'line-through' : 'none', opacity: t.status === 'done' ? 0.55 : 1 }}>{t.text}</span>
          </div>
        ))}
        <div className="row" style={{ marginTop: 8 }}>
          <input className="input" style={{ fontSize: 12.5, padding: '5px 8px' }} placeholder="添加待确认事项…" value={newTodo} onChange={(e) => setNewTodo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTodo()} />
          <Btn size="sm" onClick={addTodo}><Plus size={13} /></Btn>
        </div>
      </div>
      <div className="ctx-block">
        <span className="sec-label">已确认研究问题 · {questions.length}</span>
        {questions.map((q) => (
          <div key={q.id} className="ctx-item">
            <span className="txt" style={{ fontWeight: 500 }}>{q.title}</span>
          </div>
        ))}
        {!questions.length && <div className="tiny" style={{ marginTop: 6 }}>确认后的科学问题将进入申报写作</div>}
      </div>
    </div>
  );
}
