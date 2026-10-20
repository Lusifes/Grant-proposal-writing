import React, { useEffect, useState } from 'react';
import { AppProvider, Toasts, useApp } from './store.jsx';
import { parseRoute, navigate } from './router.js';
import TopBar from './components/TopBar.jsx';
import { Btn, Field } from './components/ui.jsx';
import { api } from './api.js';
import Home from './pages/Home.jsx';
import Workspace from './pages/Workspace.jsx';
import Settings from './pages/Settings.jsx';

function NewProjectModal({ onClose }) {
  const { refreshProjects, selectProject, toast } = useApp();
  const [form, setForm] = useState({
    name: '', direction: '', grant_type: '国家自然科学基金面上项目',
    year: String(new Date().getFullYear()), foundation: '', requirements: '', ai_mode: 'restricted'
  });
  const submit = async () => {
    if (!form.name.trim()) return toast('请填写项目名称', 'err');
    try {
      const p = await api.projects.create(form);
      await refreshProjects();
      selectProject(p.id);
      onClose();
      toast('项目已创建', 'ok');
      navigate(`/p/${p.id}`);
    } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <div className="modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <h3>新建项目</h3>
        <Field label="项目名称"><input className="input" value={form.name} placeholder="如：机器学习预测高熵合金力学性能" onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="研究方向"><input className="input" value={form.direction} placeholder="如：计算材料学 / 高熵合金" onChange={(e) => setForm({ ...form, direction: e.target.value })} /></Field>
        <div className="row">
          <Field label="申报类型" className="grow">
            <select className="input" value={form.grant_type} onChange={(e) => setForm({ ...form, grant_type: e.target.value })}>
              <option>国家自然科学基金面上项目</option>
              <option>科技研发项目</option>
              <option>通用项目申请书</option>
            </select>
          </Field>
          <Field label="申报年度" style={{ width: 140 }}><input className="input" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} /></Field>
        </div>
        <Field label="AI 辅助模式" hint="允许 AI 起草 → 分章节草稿；仅辅助论证材料 → 提纲/证据/审校（适用于限制 AI 撰写申请书的项目）。">
          <select className="input" value={form.ai_mode} onChange={(e) => setForm({ ...form, ai_mode: e.target.value })}>
            <option value="restricted">仅辅助论证材料（提纲/证据/审校）</option>
            <option value="draft_allowed">允许 AI 起草（分章节草稿）</option>
          </select>
        </Field>
        <Field label="已有研究基础（可选）"><textarea className="textarea" style={{ minHeight: 56 }} value={form.foundation} placeholder="前期积累、实验条件、经费与团队信息（将作为申报写作的真实资料）" onChange={(e) => setForm({ ...form, foundation: e.target.value })} /></Field>
        <Field label="补充要求（可选）"><textarea className="textarea" style={{ minHeight: 56 }} value={form.requirements} placeholder="申报书格式、篇幅、注意事项等" onChange={(e) => setForm({ ...form, requirements: e.target.value })} /></Field>
        <div className="modal-foot">
          <Btn onClick={onClose}>取消</Btn>
          <Btn variant="primary" onClick={submit}>创建项目</Btn>
        </div>
      </div>
    </div>
  );
}

function Router() {
  const [route, setRoute] = useState(() => parseRoute());
  const [showNew, setShowNew] = useState(false);
  const { ready } = useApp();

  useEffect(() => {
    const onHash = () => setRoute(parseRoute());
    const onNew = () => setShowNew(true);
    window.addEventListener('hashchange', onHash);
    window.addEventListener('rgs:new-project', onNew);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('rgs:new-project', onNew);
    };
  }, []);

  if (!ready) {
    return <div className="page"><div className="page-inner muted">正在加载工作台…</div></div>;
  }

  let page;
  if (route.page === 'project' && route.stage) {
    page = <Workspace projectId={route.id} stage={route.stage} key={`${route.id}-${route.stage}`} />;
  } else if (route.page === 'project') {
    page = <Home projectId={route.id} onCreateProject={() => setShowNew(true)} />;
  } else if (route.page === 'settings') {
    page = <Settings />;
  } else {
    page = <Home projectId={null} onCreateProject={() => setShowNew(true)} />;
  }

  return (
    <div className="app">
      <TopBar onCreateProject={() => setShowNew(true)} />
      <div className="app-body">{page}</div>
      <Toasts />
      {showNew && <NewProjectModal onClose={() => setShowNew(false)} />}
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Router />
    </AppProvider>
  );
}
