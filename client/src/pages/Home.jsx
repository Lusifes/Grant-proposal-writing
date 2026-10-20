import React, { useEffect, useMemo, useState } from 'react';
import {
  Search, PenTool, FileText, BookOpenCheck, Lightbulb, ClipboardCheck,
  Settings, Download, ChevronRight, FolderPlus, Boxes
} from 'lucide-react';
import { useApp, STAGE_INFO } from '../store.jsx';
import { api, download } from '../api.js';
import { Btn, Badge, EmptyState, StatusBadge, Spinner } from '../components/ui.jsx';
import { navigate } from '../router.js';

export default function Home({ projectId, onCreateProject }) {
  const { currentId, settings, toast, running } = useApp();
  const [detail, setDetail] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const id = projectId || currentId;

  useEffect(() => {
    setDetail(null);
    if (id) {
      api.projects.get(id).then(setDetail).catch((e) => toast(e.message, 'err'));
    }
  }, [id]);

  const stageIcons = { 1: <Search size={16} />, 2: <PenTool size={16} />, 3: <FileText size={16} /> };

  const workPhase = useMemo(() => {
    if (!detail) return '';
    const { stage1, stage2, stage3 } = detail;
    if (stage3 !== 'not_started') return `申报写作 · ${stage3 === 'completed' ? '已完成' : '进行中'}`;
    if (stage2 !== 'not_started') return `研究论证 · ${stage2 === 'completed' ? '已完成' : '进行中'}`;
    if (stage1 !== 'not_started') return `文献调研 · ${stage1 === 'completed' ? '已完成' : '进行中'}`;
    return '未开始';
  }, [detail]);

  const nextStep = useMemo(() => {
    if (!detail) return null;
    const { stage1, stage2, stage3 } = detail;
    if (stage1 === 'not_started') return { target: 1, text: '开始文献调研：检索真实文献，勾选核心论文后完成 Step 1' };
    if (stage1 === 'in_progress') return { target: 1, text: '继续文献调研：勾选至少 1 篇核心论文后完成 Step 1' };
    if (stage2 === 'not_started' || stage2 === 'in_progress') return { target: 2, text: '继续研究论证：运行跨论文分析，确认至少 1 个科学问题后完成 Step 2' };
    if (stage3 === 'not_started' || stage3 === 'in_progress') return { target: 3, text: '进入申报写作：按章节生成/撰写内容，运行检查后导出成果' };
    return { target: 3, text: '三阶段已完成：导出成果，或返回任一阶段修订' };
  }, [detail]);

  const doExport = (format) => {
    if (!id) return;
    setExportOpen(false);
    download(`/api/projects/${id}/export?format=${format}`, '');
  };

  if (!id) {
    return (
      <div className="page">
        <div className="page-inner" style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
          <div style={{ textAlign: 'center', maxWidth: 420 }}>
            <div style={{ marginBottom: 16, color: 'var(--text-4)' }}><Boxes size={44} strokeWidth={1.2} /></div>
            <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>欢迎使用 ResearchGrant Studio</div>
            <div className="muted" style={{ marginBottom: 22 }}>面向科研人员、高校教师与企业研发人员的 AI 项目申报辅助平台。创建项目后，按「文献调研 → 研究论证 → 申报写作」三阶段完成申报材料准备。</div>
            <Btn variant="primary" size="lg" onClick={onCreateProject}><FolderPlus size={16} /> 新建项目</Btn>
          </div>
        </div>
      </div>
    );
  }

  if (!detail) {
    return <div className="page"><div className="page-inner"><div className="muted">加载中…</div></div></div>;
  }

  const chips = [
    detail.grant_type && <Badge key="g" tone="blue">{detail.grant_type}</Badge>,
    detail.year && <Badge key="y">{detail.year} 年度</Badge>,
    <Badge key="ai" tone={detail.ai_mode === 'draft_allowed' ? 'green' : ''}>{detail.ai_mode === 'draft_allowed' ? 'AI 辅助起草' : 'AI 辅助研究'}</Badge>,
    <Badge key="p" tone="amber">{workPhase}</Badge>
  ].filter(Boolean);

  const stats = detail.stats;
  const statRows = [
    { icon: <BookOpenCheck size={15} />, label: '已核验文献', count: `${stats.verified} 篇`, target: '/p/' + id + '/stage/1', hint: `共 ${stats.literatures} 篇` },
    { icon: <Lightbulb size={15} />, label: '候选科学问题', count: `${stats.questions} 项`, target: '/p/' + id + '/stage/2', hint: `已确认 ${stats.confirmedQ} 项` },
    { icon: <ClipboardCheck size={15} />, label: '待人工确认', count: `${stats.todosPending} 项`, target: '/p/' + id + '/stage/3', hint: '含问题确认与事项审核' }
  ];

  return (
    <div className="page">
      <div className="page-inner">
        {/* 当前项目 */}
        <div className="home-head">
          <div className="grow">
            <div className="sec-label" style={{ marginBottom: 6 }}>当前项目</div>
          </div>
          <Btn variant="ghost" size="sm" onClick={() => navigate('/settings')}><Settings size={14} /> 设置</Btn>
        </div>
        <div className="card card-pad project-block">
          <div className="row wrap">
            <div className="grow" style={{ minWidth: 260 }}>
              <div className="pname">{detail.name}</div>
              <div className="chips">{chips}</div>
            </div>
            <div className="row">
              <Btn size="sm" variant="ghost" onClick={() => navigate(`/p/${id}/stage/${detail.stage1 === 'completed' ? 2 : 1}`)}>
                打开项目 <ChevronRight size={14} />
              </Btn>
              <Btn size="sm" variant="ghost" onClick={() => { setExportOpen(!exportOpen); }}>
                <Download size={14} /> 导出成果
              </Btn>
            </div>
          </div>
          {nextStep && (
            <div className="next-step">
              <span className="tiny" style={{ color: 'var(--text-4)', flex: 'none' }}>下一步</span>
              <span className="t">{nextStep.text}</span>
              {running && <span className="run-chip"><Spinner size={12} /> {running.label}</span>}
              <Btn size="sm" variant="primary" onClick={() => navigate(`/p/${id}/stage/${nextStep.target}`)}>前往 <ChevronRight size={14} /></Btn>
            </div>
          )}
        </div>

        {/* 三阶段工作流 */}
        <div className="steps">
          {[1, 2, 3].map((s) => {
            const info = STAGE_INFO[s];
            const status = detail[`stage${s}`];
            return (
              <div key={s} className="step-card" onClick={() => navigate(`/p/${id}/stage/${s}`)}>
                <div className="ic">{stageIcons[s]}</div>
                <div>
                  <div className="st-name">{info.name}</div>
                  <div className="st-sub">{info.step} · {info.sub}</div>
                </div>
                <div className="st-foot">
                  {running && running.stage === s && <span className="run-dot" title={running.label} />}
                  <StatusBadge status={status} />
                  <ChevronRight size={15} style={{ color: 'var(--text-4)' }} />
                </div>
              </div>
            );
          })}
        </div>

        {/* 工作区 */}
        <div className="workspace-grid">
          <div className="card card-pad">
            <div className="sec-label" style={{ marginBottom: 6 }}>工作区 · 文献证据库</div>
            <div className="stat-list">
              {statRows.map((r) => (
                <div key={r.label} className="stat-row" onClick={() => navigate(r.target)}>
                  <span style={{ color: 'var(--text-3)', display: 'flex' }}>{r.icon}</span>
                  <span className="stat-label">{r.label}</span>
                  <span className="tiny" style={{ marginLeft: 2 }}>{r.hint}</span>
                  <span className="stat-count">{r.count}</span>
                  <ChevronRight size={14} style={{ color: 'var(--text-4)' }} />
                </div>
              ))}
            </div>
          </div>
          <div className="card card-pad">
            <div className="sec-label" style={{ marginBottom: 6 }}>最近生成的研究成果</div>
            {detail.recent && detail.recent.length ? (
              <div>
                {detail.recent.map((a) => (
                  <div key={a.id} className="recent-item" onClick={() => navigate(`/p/${id}/stage/${a.stage || 1}`)}>
                    <span className="tiny" style={{ color: 'var(--text-4)', flex: 'none' }}>S{a.stage}</span>
                    <span className="t grow">{a.title}</span>
                    <span className="tiny">{new Date(a.updated_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState text="暂无成果。进入任一阶段开始工作后，成果会出现在这里。" />
            )}
          </div>
        </div>

        {/* 底部状态栏 */}
        <div className="footerbar">
          <div className="model-state">
            <span className={`badge dot ${settings && settings.keySet ? 'green' : 'amber'}`} />
            <span>模型：{settings && settings.keySet ? `${settings.providerLabel || '已配置'} · ${settings.model}` : '用户自行配置（未配置）'}</span>
          </div>
          <div className="spacer" />
          <div style={{ position: 'relative' }}>
            <Btn variant="primary" onClick={() => setExportOpen(!exportOpen)}><Download size={14} /> 导出成果</Btn>
            {exportOpen && (
              <div className="card" style={{ position: 'absolute', right: 0, bottom: 42, minWidth: 220, zIndex: 40, padding: 6 }}>
                {[
                  { f: 'md', label: 'Markdown（.md）' },
                  { f: 'docx', label: 'Word 文档（.docx）' },
                  { f: 'refs', label: '文献清单（.md）' },
                  { f: 'refs&refFormat=csv', label: '文献清单（.csv）' }
                ].map((o) => (
                  <div key={o.label} className="ctx-item" style={{ cursor: 'pointer', padding: '8px 10px', border: 'none' }} onClick={() => doExport(o.f)}>
                    {o.label}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
