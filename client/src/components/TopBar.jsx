import React, { useRef, useState } from 'react';
import { FlaskConical, Settings, FolderPlus, ChevronDown } from 'lucide-react';
import { useApp } from '../store.jsx';
import { api } from '../api.js';
import { Btn, Modal, Field } from './ui.jsx';
import { navigate } from '../router.js';

export default function TopBar({ onCreateProject }) {
  const { projects, settings, current, currentId, selectProject, refreshProjects, toast } = useApp();
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: '', direction: '', grant_type: '国家自然科学基金面上项目', year: String(new Date().getFullYear()), foundation: '', requirements: '', ai_mode: 'restricted' });

  const submit = async () => {
    try {
      const p = await api.projects.create(form);
      await refreshProjects();
      selectProject(p.id);
      setShowNew(false);
      setForm({ name: '', direction: '', grant_type: '国家自然科学基金面上项目', year: String(new Date().getFullYear()), foundation: '', requirements: '', ai_mode: 'restricted' });
      toast('项目已创建', 'ok');
      navigate(`/p/${p.id}`);
    } catch (e) {
      toast(e.message, 'err');
    }
  };

  return (
    <>
      <header className="topbar">
        <div className="brand" onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>
          <span className="brand-mark"><FlaskConical size={15} strokeWidth={2.2} /></span>
          ResearchGrant Studio
        </div>
        <div className="topbar-spacer" />
        <div className="proj-switch">
          <select value={currentId} onChange={(e) => { const id = e.target.value; selectProject(id); navigate(id ? `/p/${id}` : '/'); }}>
            <option value="">选择项目…</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <Btn size="sm" onClick={() => setShowNew(true)}><FolderPlus size={14} /> 新建项目</Btn>
          <Btn variant="ghost icon" title="设置" onClick={() => navigate('/settings')}><Settings size={17} /></Btn>
        </div>
      </header>

      <Modal open={showNew} onClose={() => setShowNew(false)} title="新建项目"
        footer={<>
          <Btn onClick={() => setShowNew(false)}>取消</Btn>
          <Btn variant="primary" onClick={submit}>创建项目</Btn>
        </>}>
        <Field label="项目名称"><input className="input" value={form.name} placeholder="如：机器学习预测高熵合金力学性能" onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="研究方向"><input className="input" value={form.direction} placeholder="如：计算材料学 / 高熵合金" onChange={(e) => setForm({ ...form, direction: e.target.value })} /></Field>
        <div className="row">
          <Field label="申报类型" className="grow">
            <select className="input" value={form.grant_type} onChange={(e) => setForm({ ...form, grant_type: e.target.value })}>
              <option>国家自然科学基金面上项目</option>
              <option>科技研发项目</option>
              <option>通用项目申请书</option>
              {projects.length === 0 ? null : projects.filter(() => false).map(() => null)}
            </select>
          </Field>
          <Field label="申报年度" style={{ width: 140 }}>
            <input className="input" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} />
          </Field>
        </div>
        <Field label="AI 辅助模式" hint="允许 AI 起草 → 可生成分章节草稿；仅辅助论证材料 → 只生成提纲/证据整理，适用于限制 AI 直接撰写申请书的项目。">
          <select className="input" value={form.ai_mode} onChange={(e) => setForm({ ...form, ai_mode: e.target.value })}>
            <option value="restricted">仅辅助论证材料（提纲/证据/审校）</option>
            <option value="draft_allowed">允许 AI 起草（分章节草稿）</option>
          </select>
        </Field>
        <Field label="已有研究基础（可选）"><textarea className="textarea" style={{ minHeight: 60 }} value={form.foundation} placeholder="团队积累、前期数据、设备条件、经费来源等（将作为申报写作的真实资料）" onChange={(e) => setForm({ ...form, foundation: e.target.value })} /></Field>
        <Field label="补充要求（可选）"><textarea className="textarea" style={{ minHeight: 60 }} value={form.requirements} placeholder="申报书格式、篇幅、特别注意事项等" onChange={(e) => setForm({ ...form, requirements: e.target.value })} /></Field>
      </Modal>
    </>
  );
}
