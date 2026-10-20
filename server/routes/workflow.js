'use strict';
const fs = require('fs');
const express = require('express');
const { db } = require('../db');
const { getAISettings, uid, now } = require('./core');
const { chatOnce, chatStream, ApiError } = require('../lib/ai');
const { searchOpenAlex, searchCrossref, mergeResults, normTitle } = require('../lib/scholarly');
const { normalizeItem } = require('./literature');
const jobs = require('../lib/jobs');

const router = express.Router();

// ================= 工具 =================
function parseAuthors(l) {
  try { const a = JSON.parse(l.authors || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}

function serializeArt(row) {
  let meta = {};
  try { meta = JSON.parse(row.meta || '{}'); } catch (e) { meta = {}; }
  return { ...row, meta };
}

function serializeLit(row) {
  return { ...row, authors: parseAuthors(row) };
}

function parseQuestions(md) {
  const out = [];
  const re = /\*\*Q\d+\.\s*([^*\n]+)\*\*([\s\S]*?)(?=\*\*Q\d+\.\s|\n*$)/g;
  let m;
  while ((m = re.exec(md))) {
    const title = m[1].trim();
    const body = m[2].trim();
    const grab = (label) => {
      const mm = body.match(new RegExp(`[-*]\\s*${label}：([\\s\\S]*?)(?=\\n[-*]\\s*(?:支持证据|最强反对意见|未验证条件)|$)`));
      return mm ? mm[1].trim() : '';
    };
    if (!title) continue;
    out.push({ title, support: grab('支持证据'), objection: grab('最强反对意见'), unverified: grab('未验证条件'), body });
  }
  if (!out.length) {
    const m2 = md.match(/(?:^|\n)\s*\d+\.\s*\*\*?([^*\n]+)\*\*?/);
    if (m2) out.push({ title: m2[1].trim(), support: '', objection: '', unverified: '', body: '' });
  }
  return out;
}

// 解析 Markdown 表格 → 结构化矩阵（含原始表格块用于回写）
function parseMatrix(md) {
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
  return { cols, rows, tableBlock: block.join('\n') };
}

function buildMatrixMd(matrix) {
  const head = ['维度', ...matrix.cols.map((c) => c.label)];
  const sep = '|' + head.map(() => '---').join('|') + '|';
  const rows = matrix.rows.map((r) => '| ' + [r.dimension || '', ...r.cells.map((c) => c || '待补充')].join(' | ') + ' |');
  return '| ' + head.join(' | ') + ' |\n' + sep + '\n' + rows.join('\n');
}

function builtinStrategy(topic, focus) {
  const words = String(topic).split(/[\s,，、;；:：/]+/).filter((w) => w.length > 1).slice(0, 5);
  const base = words.join(' ');
  const fw = String(focus || '').split(/[\s,，、;；:：/]+/).filter((w) => w.length > 1).slice(0, 3).join(' ');
  const q = fw ? `${base} ${fw}` : base;
  const subs = [q, `${base} prediction`, `${base} machine learning`].filter((x, i, a) => x && a.indexOf(x) === i);
  return {
    mainQuery: base,
    subQueries: subs,
    note: '未配置模型，已使用内置关键词检索策略（建议配置 AI 生成更精确的检索式）'
  };
}

async function aiSearchStrategy(settings, { topic, focus, fromYear, toYear, targetCount }) {
  const prompt = `你是科研文献检索策略专家。请针对以下研究主题生成学术检索策略。\n研究主题：${topic}\n研究重点：${focus || '（未指定）'}\n时间范围：${fromYear || '不限'} ~ ${toYear || '不限'}\n目标文献数量：约 ${targetCount || 20} 篇\n\n只输出一个 JSON 对象（不要输出任何其他内容）：\n{"mainQuery":"英文核心检索式","subQueries":["英文检索式2","英文检索式3","英文检索式4"],"note":"检索策略说明（50 字以内）"}\n\n要求：检索式应覆盖核心概念与关键同义词，用 OR 组合同义表达，避免过宽或过窄；若主题为中文，请翻译为恰当的英文关键词。`;
  const text = await chatOnce(settings, [
    { role: 'system', content: '你是科研检索策略专家，只输出 JSON。' },
    { role: 'user', content: prompt }
  ], { maxTokens: 700, temperature: 0.2 });
  const m = text.match(/\{[\s\S]*\}/);
  const obj = JSON.parse(m ? m[0] : text);
  if (!obj.mainQuery) return null;
  return {
    mainQuery: obj.mainQuery,
    subQueries: Array.isArray(obj.subQueries) ? obj.subQueries.slice(0, 4) : [],
    note: obj.note || ''
  };
}

function upsertChapter(projectId, chapterId, title, content, aborted) {
  const meta = JSON.stringify({ chapterId });
  const existing = db.prepare("SELECT * FROM artifacts WHERE project_id = ? AND kind = 'chapter' AND meta = ?").get(projectId, meta);
  const t = now();
  if (existing) {
    db.prepare('UPDATE artifacts SET content = ?, title = ?, updated_at = ? WHERE id = ?').run(content, title, t, existing.id);
    return db.prepare('SELECT * FROM artifacts WHERE id = ?').get(existing.id);
  }
  const id = uid();
  db.prepare('INSERT INTO artifacts (id, project_id, stage, kind, title, content, version, meta, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(id, projectId, 3, 'chapter', title, content, 1, meta, t, t);
  return db.prepare('SELECT * FROM artifacts WHERE id = ?').get(id);
}

function readMaterialsText(projectId, cap = 12000) {
  const ups = db.prepare('SELECT * FROM uploads WHERE project_id = ? ORDER BY created_at DESC').all(projectId);
  let out = [];
  let total = 0;
  for (const u of ups) {
    if (!u.text_path || !fs.existsSync(u.text_path)) continue;
    let t;
    try { t = fs.readFileSync(u.text_path, 'utf8'); } catch (e) { continue; }
    const remain = cap - total;
    if (remain <= 0) break;
    const slice = t.slice(0, remain);
    total += slice.length;
    out.push(`【资料：${u.filename}】\n${slice}`);
  }
  return out.join('\n\n');
}

async function buildChapterContext(project, chapter) {
  const lits = db.prepare('SELECT * FROM literatures WHERE project_id = ? AND selected = 1').all(project.id);
  const report = db.prepare("SELECT * FROM artifacts WHERE project_id = ? AND kind = 'report' ORDER BY updated_at DESC LIMIT 1").get(project.id);
  const questions = db.prepare("SELECT * FROM artifacts WHERE project_id = ? AND kind = 'question' AND confirmed = 1 ORDER BY updated_at").all(project.id);
  const materials = readMaterialsText(project.id);
  const litBlock = lits.map((l, i) => {
    const a = parseAuthors(l).join(', ');
    return `[${i + 1}] ${l.title}（${a || '作者未知'}，${l.year || '?'}${l.doi ? '，DOI: ' + l.doi : ''}）\n摘要：${(l.abstract || '').slice(0, 900)}`;
  }).join('\n\n');
  const qBlock = questions.map((q, i) => `${i + 1}. ${q.title}`).join('\n');
  const draftAllowed = project.ai_mode === 'draft_allowed';

  const task = draftAllowed
    ? `为申报书章节「${chapter.title}」撰写完整正文草稿（Markdown 格式，使用标题与段落）。\n章节写作要求：${chapter.guide || '无'}`
    : `为申报书章节「${chapter.title}」生成《章节提纲与论证材料》（Markdown）：\n1. 章节目标与核心论点清单；\n2. 每个论点的支撑证据（必须来自下方已核验文献/项目资料，注明文献编号）；\n3. 论证结构与段落提纲；\n4. 需人工补充的信息清单（实验条件、经费、团队等缺失项逐一列出）。\n注意：本项目采用“仅辅助论证材料”模式，不得输出可直接提交的完整申请书正文。`;

  const prompt = `你是资深科研项目申请书撰写专家。为以下项目准备申报材料。\n\n项目名称：${project.name}\n申报类型：${project.grant_type}${project.year ? '｜申报年度：' + project.year : ''}\n研究方向：${project.direction || '未填写'}\n\n${task}\n\n可用的真实资料（严禁编造，缺失信息必须写“待补充”）：\n${project.foundation ? '已有研究基础：' + project.foundation + '\n' : ''}${project.requirements ? '补充要求：' + project.requirements + '\n' : ''}${materials ? '用户上传的项目资料：\n' + materials.slice(0, 9000) + '\n' : ''}${litBlock ? '已核验文献：\n' + litBlock : '（暂无已确认文献）'}${report ? '\n研究现状报告（节选）：\n' + report.content.slice(0, 2500) : ''}${qBlock ? '\n确认的科学问题：\n' + qBlock : ''}\n\n请直接输出内容，不要复述本提示。`;

  return {
    prompt,
    messages: [
      { role: 'system', content: '你是严谨、专业的科研项目申报写作助手。' },
      { role: 'user', content: prompt }
    ]
  };
}

function sseHeaders(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  return (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

// ================= 阶段一：文献调研 =================
router.post('/projects/:id/stage1/run', async (req, res, next) => {
  try {
    const { topic, fromYear, toYear, focus, targetCount } = req.body || {};
    if (!topic || !String(topic).trim()) return res.status(400).json({ error: '请填写研究主题' });
    const settings = getAISettings();
    let strategy = null;
    let strategySource = 'builtin';
    if (settings && settings.apiKey) {
      try {
        strategy = await aiSearchStrategy(settings, { topic, focus, fromYear, toYear, targetCount });
        if (strategy) strategySource = 'ai';
      } catch (e) { strategy = null; }
    }
    if (!strategy) { strategy = builtinStrategy(topic, focus); strategySource = 'builtin'; }

    const queries = [strategy.mainQuery, ...(strategy.subQueries || [])].filter(Boolean).slice(0, 4);
    const per = Math.max(10, Math.min(25, Math.ceil(((targetCount || 20) * 1.5) / Math.max(1, queries.length))));
    const lists = [];
    const sourceStatus = { openalex: 'ok', crossref: 'ok' };
    for (const q of queries) {
      let al = [];
      let cr = [];
      try { al = await searchOpenAlex(q, { from: fromYear || undefined, to: toYear || undefined, perPage: per }); }
      catch (e) { sourceStatus.openalex = e.message || 'error'; }
      try { cr = await searchCrossref(q, { from: fromYear || undefined, to: toYear || undefined, rows: per }); }
      catch (e) { sourceStatus.crossref = e.message || 'error'; }
      lists.push(al, cr);
    }
    const items = mergeResults(lists)
      .sort((a, b) => ((b.abstract ? 1 : 0) - (a.abstract ? 1 : 0)) || (b.cited_by || 0) - (a.cited_by || 0))
      .slice(0, (targetCount || 20) * 2);

    const existing = db.prepare('SELECT doi, title FROM literatures WHERE project_id = ?').all(req.params.id);
    const seen = new Set(existing.map((e) => (e.doi ? 'doi:' + e.doi.toLowerCase() : 't:' + normTitle(e.title))));
    const ins = db.prepare(
      'INSERT INTO literatures (id, project_id, title, authors, year, doi, source, url, abstract, status, fulltext_url, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
    );
    let added = 0;
    for (const item of items) {
      const n = normalizeItem(item);
      const key = n.doi ? 'doi:' + n.doi.toLowerCase() : 't:' + normTitle(n.title);
      if (seen.has(key)) continue;
      seen.add(key);
      ins.run(uid(), req.params.id, n.title, JSON.stringify(n.authors), n.year, n.doi, n.source, n.url, n.abstract, n.status, n.fulltext_url || '', now());
      added++;
    }
    const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    if (p.stage1 === 'not_started') {
      db.prepare("UPDATE projects SET stage1 = 'in_progress', updated_at = ? WHERE id = ?").run(now(), req.params.id);
    }
    const lits = db.prepare('SELECT * FROM literatures WHERE project_id = ? ORDER BY created_at DESC').all(req.params.id);
    res.json({ strategy, strategySource, queries, added, total: lits.length, literatures: lits, sourceStatus });
  } catch (e) { next(e); }
});

router.post('/projects/:id/stage1/report', async (req, res, next) => {
  try {
    const settings = getAISettings();
    if (!settings || !settings.apiKey) {
      return res.status(400).json({ error: '生成研究现状报告需要配置模型 API，请先前往「设置」配置并测试连接。' });
    }
    const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    if (!p) return res.status(404).json({ error: '项目不存在' });
    const lits = db.prepare('SELECT * FROM literatures WHERE project_id = ? AND abstract != ?').all(req.params.id, '');
    if (!lits.length) {
      return res.status(400).json({ error: '暂无可分析文献（需要至少一篇含摘要的文献）。请先执行检索，或手动补充摘要/上传 PDF。' });
    }
    const topic = (req.body && req.body.topic) || p.direction || p.name;
    const focus = (req.body && req.body.focus) || '';
    const litBlock = lits.map((l, i) => {
      const a = parseAuthors(l).join(', ');
      return `[${i + 1}] ${l.title}（${a || '作者未知'}，${l.year || '?'}${l.doi ? '，DOI: ' + l.doi : ''}）\n摘要：${(l.abstract || '').slice(0, 1500)}`;
    }).join('\n\n');

    const prompt = `你是科研项目管理专家。请基于以下已核验文献撰写《研究现状报告》。\n项目主题：${topic}\n研究重点：${focus || '（未指定）'}\n\n文献列表（真实检索自 OpenAlex/Crossref）：\n${litBlock}\n\n输出要求（Markdown）：\n# 研究现状报告\n## 一、研究现状综述（按主题聚类，引用文献编号 [n]）\n## 二、研究方法与适用边界\n## 三、主要争议\n## 四、研究空白\n## 五、候选科学问题\n\n候选科学问题请严格使用以下格式，每个问题包含三要素：\n**Q1. 问题标题**\n- 支持证据：...\n- 最强反对意见：...\n- 未验证条件：...\n\n只基于给定文献撰写，不得编造文献、数据或结论；信息不足处写“待补充”。`;

    const ctrl = new AbortController();
    if (req.body && req.body.jobId) jobs.register(req.body.jobId, ctrl);
    let text;
    try {
      text = await chatOnce(settings, [
        { role: 'system', content: '你是严谨的科研现状调研专家。' },
        { role: 'user', content: prompt }
      ], { signal: ctrl.signal, maxTokens: 4200, temperature: 0.3 });
    } finally {
      if (req.body && req.body.jobId) jobs.remove(req.body.jobId);
    }

    const reportId = uid();
    db.prepare('INSERT INTO artifacts (id, project_id, stage, kind, title, content, version, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(reportId, req.params.id, 1, 'report', '研究现状报告', text, 1, now(), now());

    const qs = parseQuestions(text);
    const insQ = db.prepare('INSERT INTO artifacts (id, project_id, stage, kind, title, content, confirmed, meta, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
    const insTodo = db.prepare('INSERT INTO todos (id, project_id, stage, text, status, created_at) VALUES (?,?,?,?,?,?)');
    const qIds = [];
    for (const q of qs) {
      const id = uid();
      insQ.run(id, req.params.id, 1, 'question', q.title,
        `- 支持证据：${q.support}\n- 最强反对意见：${q.objection}\n- 未验证条件：${q.unverified}`,
        0, JSON.stringify({ support: q.support, objection: q.objection, unverified: q.unverified }), now(), now());
      insTodo.run(uid(), req.params.id, 1, `审核并确认候选科学问题：${q.title}`, 'pending', now());
      qIds.push(id);
    }
    if (!qs.length) {
      insTodo.run(uid(), req.params.id, 1, '候选科学问题未结构化解析，请手动补充并确认', 'pending', now());
    }
    insTodo.run(uid(), req.params.id, 1, '选择核心论文并进入研究论证（Step 2）', 'pending', now());
    const p2 = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    if (p2.stage1 !== 'completed') {
      db.prepare("UPDATE projects SET stage1 = 'pending_review', updated_at = ? WHERE id = ?").run(now(), req.params.id);
    }
    res.json({ reportId, questions: qs, questionIds: qIds });
  } catch (e) { next(e); }
});

router.post('/projects/:id/stage1/complete', (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: '项目不存在' });
  const sel = db.prepare('SELECT COUNT(*) n FROM literatures WHERE project_id = ? AND selected = 1').get(req.params.id);
  if (!sel.n) return res.status(400).json({ error: '请先选择至少 1 篇核心论文（勾选文献），再进入研究论证。' });
  db.prepare("UPDATE projects SET stage1 = 'completed', updated_at = ? WHERE id = ?").run(now(), req.params.id);
  if (p.stage2 === 'not_started') db.prepare("UPDATE projects SET stage2 = 'in_progress', updated_at = ? WHERE id = ?").run(now(), req.params.id);
  res.json(db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id));
});

// ================= 阶段二：研究论证 =================
router.post('/projects/:id/stage2/cross', async (req, res, next) => {
  try {
    const settings = getAISettings();
    if (!settings || !settings.apiKey) {
      return res.status(400).json({ error: '跨论文分析需要配置模型 API，请先前往「设置」配置并测试连接。' });
    }
    const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    if (!p) return res.status(404).json({ error: '项目不存在' });
    const lits = db.prepare('SELECT * FROM literatures WHERE project_id = ? AND selected = 1').all(req.params.id);
    if (!lits.length) return res.status(400).json({ error: '尚未选择核心论文。请返回阶段一勾选核心论文。' });

    const litBlock = lits.map((l, i) => {
      const a = parseAuthors(l).join(', ');
      return `[${i + 1}] ${l.title}（${a || '作者未知'}，${l.year || '?'}${l.doi ? '，DOI: ' + l.doi : ''}）\n摘要：${(l.abstract || '').slice(0, 1200)}${l.analysis ? '\n批判性分析：\n' + l.analysis.slice(0, 2000) : ''}`;
    }).join('\n\n');

    const prompt = `你是科研项目论证专家。基于以下核心论文（真实检索 + 摘要/全文分析）进行跨论文论证。\n项目主题：${p.direction || p.name}\n\n核心论文：\n${litBlock}\n\n输出要求（Markdown）：\n# 文献对比矩阵\n| 维度 | ${lits.map((_, i) => `文献${i + 1}`).join(' | ')} |\n| --- | ${lits.map(() => '---').join(' | ')} |\n（维度至少包含：研究问题、核心方法、数据/材料、主要结论、局限）\n## 现有方法的共同局限\n## 候选科学问题\n每个候选问题严格使用以下格式：\n**Q1. 问题标题**\n- 支持证据：...\n- 最强反对意见：...\n- 未验证条件：...\n## 候选创新假设\n## 最低成本验证建议\n\n只基于给定文献分析，不得编造；信息不足写“待补充”。`;

    const ctrl = new AbortController();
    if (req.body && req.body.jobId) jobs.register(req.body.jobId, ctrl);
    let text;
    try {
      text = await chatOnce(settings, [
        { role: 'system', content: '你是严谨的科研论证与创新评估专家。' },
        { role: 'user', content: prompt }
      ], { signal: ctrl.signal, maxTokens: 4500, temperature: 0.3 });
    } finally {
      if (req.body && req.body.jobId) jobs.remove(req.body.jobId);
    }

    const matrixId = uid();
    const matrixStruct = parseMatrix(text);
    db.prepare('INSERT INTO artifacts (id, project_id, stage, kind, title, content, meta, version, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(matrixId, req.params.id, 2, 'matrix', '文献对比矩阵与研究论证', text,
        JSON.stringify(matrixStruct ? { matrix: matrixStruct } : {}), 1, now(), now());

    const qs = parseQuestions(text);
    const insQ = db.prepare('INSERT INTO artifacts (id, project_id, stage, kind, title, content, confirmed, meta, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
    const insTodo = db.prepare('INSERT INTO todos (id, project_id, stage, text, status, created_at) VALUES (?,?,?,?,?,?)');
    const qIds = [];
    for (const q of qs) {
      const id = uid();
      insQ.run(id, req.params.id, 2, 'question', q.title,
        `- 支持证据：${q.support}\n- 最强反对意见：${q.objection}\n- 未验证条件：${q.unverified}`,
        0, JSON.stringify({ support: q.support, objection: q.objection, unverified: q.unverified }), now(), now());
      insTodo.run(uid(), req.params.id, 2, `审核并确认候选科学问题：${q.title}`, 'pending', now());
      qIds.push(id);
    }
    if (!qs.length) {
      insTodo.run(uid(), req.params.id, 2, '候选问题未结构化解析，请手动补充并确认', 'pending', now());
    }
    insTodo.run(uid(), req.params.id, 2, '确认至少 1 个研究问题后进入申报写作（Step 3）', 'pending', now());
    const p2 = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    if (p2.stage2 === 'not_started') {
      db.prepare("UPDATE projects SET stage2 = 'in_progress', updated_at = ? WHERE id = ?").run(now(), req.params.id);
    }
    res.json({ matrixId, questions: qs, questionIds: qIds });
  } catch (e) { next(e); }
});

router.post('/projects/:id/stage2/complete', (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: '项目不存在' });
  const cq = db.prepare("SELECT COUNT(*) n FROM artifacts WHERE project_id = ? AND kind = 'question' AND confirmed = 1").get(req.params.id);
  if (!cq.n) return res.status(400).json({ error: '请先确认至少 1 个研究问题（在候选问题中选择“确认”），再进入申报写作。' });
  db.prepare("UPDATE projects SET stage2 = 'completed', updated_at = ? WHERE id = ?").run(now(), req.params.id);
  if (p.stage3 === 'not_started') db.prepare("UPDATE projects SET stage3 = 'in_progress', updated_at = ? WHERE id = ?").run(now(), req.params.id);
  res.json(db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id));
});

// ================= 阶段三：申报写作 =================
router.get('/projects/:id/stage3', (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: '项目不存在' });
  const tpl = db.prepare('SELECT * FROM templates WHERE id = ?').get(p.template_id) ||
    db.prepare("SELECT * FROM templates WHERE id = 'general'").get();
  const structure = tpl ? JSON.parse(tpl.structure) : [];
  const chapters = db.prepare("SELECT * FROM artifacts WHERE project_id = ? AND kind = 'chapter' ORDER BY created_at").all(req.params.id)
    .map((a) => ({ ...a, meta: JSON.parse(a.meta || '{}') }));
  const materials = db.prepare('SELECT * FROM uploads WHERE project_id = ? ORDER BY created_at DESC').all(req.params.id);
  const questions = db.prepare("SELECT * FROM artifacts WHERE project_id = ? AND kind = 'question' AND confirmed = 1 ORDER BY updated_at").all(req.params.id).map(serializeArt);
  const literatures = db.prepare('SELECT * FROM literatures WHERE project_id = ? AND selected = 1').all(req.params.id).map(serializeLit);
  const checkArt = db.prepare("SELECT * FROM artifacts WHERE project_id = ? AND kind = 'check' ORDER BY updated_at DESC LIMIT 1").get(req.params.id);
  res.json({ project: p, template: { id: tpl.id, name: tpl.name, structure }, chapters, materials, questions, literatures, check: checkArt ? serializeArt(checkArt) : null });
});

router.post('/projects/:id/stage3/generate', async (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: '项目不存在' });
  const settings = getAISettings();
  if (!settings || !settings.apiKey) {
    res.status(400).json({ error: '未配置模型 API，请先前往「设置」配置并测试连接。' });
    return;
  }
  const { chapterId, jobId } = req.body || {};
  const tpl = db.prepare('SELECT * FROM templates WHERE id = ?').get(p.template_id);
  const structure = tpl ? JSON.parse(tpl.structure) : [];
  const ch = structure.find((c) => c.id === chapterId);
  if (!ch) { res.status(400).json({ error: '章节不存在' }); return; }
  let ctx;
  try {
    ctx = await buildChapterContext(p, ch);
  } catch (e) {
    res.status(400).json({ error: e.message || '上下文准备失败' });
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  const ctrl = new AbortController();
  if (jobId) jobs.register(jobId, ctrl);
  res.on('close', () => { if (!res.writableEnded) ctrl.abort(); });

  let acc = '';
  try {
    await chatStream(settings, ctx.messages, {
      signal: ctrl.signal, maxTokens: 3200, temperature: 0.5,
      onDelta: (d) => { acc += d; send({ delta: d }); }
    });
    const artifact = upsertChapter(p.id, chapterId, ch.title, acc, false);
    if (p.stage3 === 'not_started') db.prepare("UPDATE projects SET stage3 = 'in_progress', updated_at = ? WHERE id = ?").run(now(), p.id);
    send({ done: true, artifact: serializeArt(artifact) });
  } catch (e) {
    if (e.code === 'cancelled' || e.name === 'AbortError' || e.message === '已取消生成') {
      const artifact = upsertChapter(p.id, chapterId, ch.title, acc, true);
      send({ done: true, aborted: true, artifact: serializeArt(artifact) });
    } else {
      send({ error: e.message || '生成失败' });
    }
  } finally {
    if (jobId) jobs.remove(jobId);
    res.end();
  }
});

router.post('/projects/:id/stage3/assist', async (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: '项目不存在' });
  const settings = getAISettings();
  if (!settings || !settings.apiKey) {
    res.status(400).json({ error: '未配置模型 API，请先前往「设置」配置并测试连接。' });
    return;
  }
  const { chapterId, action, instruction } = req.body || {};
  const chapter = db.prepare("SELECT * FROM artifacts WHERE project_id = ? AND kind = 'chapter' AND meta = ?").get(req.params.id, JSON.stringify({ chapterId }));
  if (!chapter) return res.status(400).json({ error: '请先生成或保存本章内容' });

  const actions = {
    expand: '请扩写本章内容：补充论证细节、方法说明与文献支撑，保持与项目目标一致。',
    condense: '请精简本章内容：去除冗余表述，保留关键论证与信息密度。',
    polish: '请修改润色本章内容：提升学术表达、逻辑连贯性与术语准确性。',
    check: '请检查本章内容：指出逻辑漏洞、事实依据不足、与项目目标不一致之处，列出问题清单与修改建议。',
    continue: '请基于本章现有内容，自然续写后续部分。',
    free: '请按用户指令修改本章内容：输出修改后的完整章节（Markdown），未被要求改动的部分保持原样；不得编造文献、数据或实验条件。'
  };
  const actionText = actions[action] || actions.polish;
  const userInstruction = instruction ? `\n用户补充要求：${instruction}` : '';
  const prompt = `以下是申报书章节「${chapter.title}」的当前内容：\n\n${chapter.content}\n\n请执行：${actionText}${userInstruction}\n\n输出处理后的内容（Markdown）。若为“检查”，则输出问题清单；不得编造文献或数据。`;

  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  const ctrl = new AbortController();
  const jobId = req.body.jobId;
  if (jobId) jobs.register(jobId, ctrl);
  res.on('close', () => { if (!res.writableEnded) ctrl.abort(); });
  try {
    await chatStream(settings, [
      { role: 'system', content: '你是严谨的科研项目申报写作助手。' },
      { role: 'user', content: prompt }
    ], { signal: ctrl.signal, maxTokens: 3000, temperature: 0.4, onDelta: (d) => send({ delta: d }) });
    send({ done: true });
  } catch (e) {
    if (e.code === 'cancelled' || e.name === 'AbortError') send({ done: true, aborted: true });
    else send({ error: e.message || '调用失败' });
  } finally {
    if (jobId) jobs.remove(jobId);
    res.end();
  }
});

router.post('/projects/:id/stage3/save', (req, res) => {
  const { chapterId, content } = req.body || {};
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: '项目不存在' });
  const tpl = db.prepare('SELECT * FROM templates WHERE id = ?').get(p.template_id);
  const structure = tpl ? JSON.parse(tpl.structure) : [];
  const ch = structure.find((c) => c.id === chapterId);
  if (!ch) return res.status(400).json({ error: '章节不存在' });
  const artifact = upsertChapter(p.id, chapterId, ch.title, content || '', false);
  res.json(serializeArt(artifact));
});

router.post('/projects/:id/stage3/version', (req, res) => {
  const { chapterId } = req.body || {};
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: '项目不存在' });
  const artifact = db.prepare("SELECT * FROM artifacts WHERE project_id = ? AND kind = 'chapter' AND meta = ?").get(req.params.id, JSON.stringify({ chapterId }));
  if (!artifact) return res.status(400).json({ error: '该章节还没有内容' });
  const v = artifact.version + 1;
  db.prepare('INSERT INTO versions (id, artifact_id, version, content, created_at) VALUES (?,?,?,?,?)')
    .run(uid(), artifact.id, v, artifact.content, now());
  db.prepare('UPDATE artifacts SET version = ? WHERE id = ?').run(v, artifact.id);
  res.json(db.prepare('SELECT * FROM artifacts WHERE id = ?').get(artifact.id));
});

router.post('/projects/:id/stage3/check', async (req, res, next) => {
  try {
    const settings = getAISettings();
    if (!settings || !settings.apiKey) return res.status(400).json({ error: '逻辑一致性检查需要配置模型 API。' });
    const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    if (!p) return res.status(404).json({ error: '项目不存在' });
    const chapters = db.prepare("SELECT * FROM artifacts WHERE project_id = ? AND kind = 'chapter' ORDER BY created_at").all(req.params.id);
    if (!chapters.length) return res.status(400).json({ error: '还没有任何章节内容' });
    const block = chapters.map((c) => `【${c.title}】\n${(c.content || '').slice(0, 2500)}`).join('\n\n');
    const prompt = `请对以下申报书各章节做逻辑一致性检查：研究目标、关键科学问题、研究内容、技术路线、预期成果之间是否自洽；章节之间是否有冲突或重复；信息是否有明显缺失。\n\n${block}\n\n输出（Markdown）：\n## 一致性问题清单\n逐条列出：涉及章节、问题描述、修改建议（若无问题写“未发现明显冲突”）。\n## 总体建议`;
    const ctrl = new AbortController();
    if (req.body && req.body.jobId) jobs.register(req.body.jobId, ctrl);
    let text;
    try {
      text = await chatOnce(settings, [
        { role: 'system', content: '你是申报书质量评审专家。' },
        { role: 'user', content: prompt }
      ], { signal: ctrl.signal, maxTokens: 3000, temperature: 0.3 });
    } finally {
      if (req.body && req.body.jobId) jobs.remove(req.body.jobId);
    }
    const id = uid();
    db.prepare('INSERT INTO artifacts (id, project_id, stage, kind, title, content, version, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, req.params.id, 3, 'check', '章节逻辑一致性检查', text, 1, now(), now());
    res.json({ artifactId: id, content: text });
  } catch (e) { next(e); }
});

// ================= 成果（Artifacts） =================
router.get('/projects/:id/artifacts', (req, res) => {
  res.json(db.prepare('SELECT * FROM artifacts WHERE project_id = ? ORDER BY updated_at DESC').all(req.params.id).map(serializeArt));
});

// 矩阵单元格编辑：更新结构化矩阵单元格并回写内容中的表格
router.post('/artifacts/:id/matrix-cell', (req, res) => {
  const row = db.prepare('SELECT * FROM artifacts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '成果不存在' });
  const { rowIndex, colIndex, text } = req.body || {};
  if (typeof rowIndex !== 'number' || typeof colIndex !== 'number') {
    return res.status(400).json({ error: '行列参数无效' });
  }
  let meta = {};
  try { meta = JSON.parse(row.meta || '{}'); } catch (e) { meta = {}; }
  let matrix = meta.matrix;
  if (!matrix || !Array.isArray(matrix.rows)) {
    matrix = parseMatrix(row.content || '');
    if (!matrix) return res.status(400).json({ error: '未能解析矩阵结构，请重新运行跨论文分析' });
    meta.matrix = matrix;
  }
  const r = matrix.rows[rowIndex];
  if (!r || !Array.isArray(r.cells) || typeof r.cells[colIndex] !== 'string') {
    return res.status(400).json({ error: '单元格不存在' });
  }
  r.cells[colIndex] = String(text == null ? '' : text).trim();
  let newContent = row.content || '';
  if (matrix.tableBlock && newContent.includes(matrix.tableBlock)) {
    newContent = newContent.replace(matrix.tableBlock, buildMatrixMd(matrix));
  } else {
    newContent = buildMatrixMd(matrix) + '\n\n' + newContent;
  }
  db.prepare('UPDATE artifacts SET meta = ?, content = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(meta), newContent, now(), req.params.id);
  res.json(serializeArt(db.prepare('SELECT * FROM artifacts WHERE id = ?').get(req.params.id)));
});

router.patch('/artifacts/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM artifacts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '成果不存在' });
  const allow = ['title', 'content', 'confirmed', 'meta'];
  const sets = [];
  const vals = [];
  for (const k of allow) {
    if (k in (req.body || {})) {
      let v = req.body[k];
      if (k === 'meta') v = JSON.stringify(v);
      sets.push(`${k} = ?`);
      vals.push(v);
    }
  }
  if (!sets.length) return res.json(serializeArt(row));
  sets.push('updated_at = ?');
  vals.push(now(), req.params.id);
  db.prepare(`UPDATE artifacts SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  res.json(serializeArt(db.prepare('SELECT * FROM artifacts WHERE id = ?').get(req.params.id)));
});

router.post('/artifacts', (req, res) => {
  const { project_id, stage = 1, kind = 'question', title, content = '', meta = {} } = req.body || {};
  if (!project_id || !title) return res.status(400).json({ error: '参数不完整' });
  const id = uid();
  db.prepare('INSERT INTO artifacts (id, project_id, stage, kind, title, content, confirmed, meta, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(id, project_id, stage, kind, String(title), String(content), 0, JSON.stringify(meta), now(), now());
  res.json(serializeArt(db.prepare('SELECT * FROM artifacts WHERE id = ?').get(id)));
});

router.delete('/artifacts/:id', (req, res) => {
  db.prepare('DELETE FROM artifacts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.get('/artifacts/:id/versions', (req, res) => {
  const row = db.prepare('SELECT * FROM artifacts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '成果不存在' });
  const versions = db.prepare('SELECT version, created_at FROM versions WHERE artifact_id = ? ORDER BY version DESC').all(req.params.id);
  res.json({ artifact: serializeArt(row), versions });
});

router.post('/artifacts/:id/restore', (req, res) => {
  const row = db.prepare('SELECT * FROM artifacts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '成果不存在' });
  const { version } = req.body || {};
  const v = db.prepare('SELECT * FROM versions WHERE artifact_id = ? AND version = ?').get(req.params.id, version);
  if (!v) return res.status(404).json({ error: '版本不存在' });
  const newV = (row.version || 1) + 1;
  db.prepare('UPDATE artifacts SET content = ?, version = ?, updated_at = ? WHERE id = ?').run(v.content, newV, now(), req.params.id);
  db.prepare('INSERT INTO versions (id, artifact_id, version, content, created_at) VALUES (?,?,?,?,?)')
    .run(uid(), req.params.id, newV, v.content, now());
  res.json(serializeArt(db.prepare('SELECT * FROM artifacts WHERE id = ?').get(req.params.id)));
});

// ================= AI 流式接口（通用）与取消 =================
router.post('/ai/stream', async (req, res) => {
  const settings = getAISettings();
  if (!settings || !settings.apiKey) {
    res.status(400).json({ error: '未配置模型 API，请先前往「设置」配置并测试连接。' });
    return;
  }
  const { jobId, messages, temperature, maxTokens } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) { res.status(400).json({ error: '消息不能为空' }); return; }
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  const ctrl = new AbortController();
  if (jobId) jobs.register(jobId, ctrl);
  res.on('close', () => { if (!res.writableEnded) ctrl.abort(); });
  try {
    await chatStream(settings, messages, { signal: ctrl.signal, temperature: temperature ?? 0.4, maxTokens: maxTokens || 2048, onDelta: (d) => send({ delta: d }) });
    send({ done: true });
  } catch (e) {
    if (e.code === 'cancelled' || e.name === 'AbortError') send({ done: true, aborted: true });
    else send({ error: e.message || '调用失败' });
  } finally {
    if (jobId) jobs.remove(jobId);
    res.end();
  }
});

router.post('/ai/cancel/:jobId', (req, res) => {
  jobs.abort(req.params.jobId);
  res.json({ ok: true });
});

module.exports = { router };
