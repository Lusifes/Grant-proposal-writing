'use strict';
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { db } = require('../db');
const { getAISettings, uid, now } = require('./core');
const { chatOnce, ApiError } = require('../lib/ai');
const { upload, extractPdfText, UPLOAD_DIR } = require('../lib/upload');
const { searchOpenAlex, searchCrossref, mergeResults, normTitle } = require('../lib/scholarly');
const jobs = require('../lib/jobs');

const router = express.Router();

const STATUS_ABSTRACT = 'abstract_obtained';

function normalizeItem(item) {
  return {
    title: item.title,
    authors: Array.isArray(item.authors) ? item.authors : [],
    year: item.year || null,
    doi: item.doi || '',
    source: item.source || '',
    url: item.url || '',
    abstract: item.abstract || '',
    status: item.abstract ? STATUS_ABSTRACT : 'metadata_only',
    fulltext_url: item.fulltext_url || ''
  };
}

function serializeLit(row) {
  return { ...row, authors: parseAuthors(row) };
}

// ---------- 文献列表 ----------
router.get('/projects/:id/literatures', (req, res) => {
  const rows = db.prepare('SELECT * FROM literatures WHERE project_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json(rows.map(serializeLit));
});

// 手动添加文献
router.post('/projects/:id/literatures', (req, res) => {
  const b = req.body || {};
  if (!b.title || !String(b.title).trim()) return res.status(400).json({ error: '标题不能为空' });
  const id = uid();
  db.prepare(`INSERT INTO literatures (id, project_id, title, authors, year, doi, source, url, abstract, status, note, created_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, req.params.id, String(b.title).trim(), JSON.stringify(b.authors || []), b.year || null,
      b.doi || '', b.source || '手动添加', b.url || '', b.abstract || '',
      b.abstract ? STATUS_ABSTRACT : 'metadata_only', b.note || '', now());
  res.json(serializeLit(db.prepare('SELECT * FROM literatures WHERE id = ?').get(id)));
});

router.patch('/literatures/:lid', (req, res) => {
  const row = db.prepare('SELECT * FROM literatures WHERE id = ?').get(req.params.lid);
  if (!row) return res.status(404).json({ error: '文献不存在' });
  const allow = ['title', 'note', 'abstract', 'analysis', 'selected', 'year', 'doi', 'url', 'authors', 'fulltext_url'];
  const sets = [];
  const vals = [];
  for (const k of allow) {
    if (k in (req.body || {})) {
      let v = req.body[k];
      if (k === 'authors') v = JSON.stringify(v);
      if (k === 'abstract' && v && row.status === 'metadata_only') {
        sets.push('status = ?'); vals.push(STATUS_ABSTRACT);
      }
      sets.push(`${k} = ?`);
      vals.push(v);
    }
  }
  if (!sets.length) return res.json(row);
  vals.push(req.params.lid);
  db.prepare(`UPDATE literatures SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  res.json(serializeLit(db.prepare('SELECT * FROM literatures WHERE id = ?').get(req.params.lid)));
});

router.delete('/literatures/:lid', (req, res) => {
  const row = db.prepare('SELECT * FROM literatures WHERE id = ?').get(req.params.lid);
  if (row && row.fulltext_path) { try { fs.unlinkSync(row.fulltext_path); } catch (e) {} }
  db.prepare('DELETE FROM literatures WHERE id = ?').run(req.params.lid);
  res.json({ ok: true });
});

function parseAuthors(l) {
  try { const a = JSON.parse(l.authors || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}

// ---------- 单篇批判性分析（阶段二） ----------
router.post('/literatures/:lid/analyze', async (req, res, next) => {
  try {
    const row = db.prepare('SELECT * FROM literatures WHERE id = ?').get(req.params.lid);
    if (!row) return res.status(404).json({ error: '文献不存在' });
    const settings = getAISettings();
    if (!settings || !settings.apiKey) return res.status(400).json({ error: '未配置模型 API，请先在「设置」中配置并测试连接' });

    let fulltext = '';
    if (row.fulltext_path) {
      try { fulltext = fs.readFileSync(row.fulltext_path, 'utf8').slice(0, 12000); } catch (e) {}
    }
    const hasFulltext = !!fulltext;
    const authors = parseAuthors(row).join(', ');
    const parts = [
      `标题：${row.title}`,
      `作者：${authors || '未知'}`,
      row.year ? `年份：${row.year}` : '',
      row.doi ? `DOI：${row.doi}` : '',
      row.abstract ? `摘要：\n${row.abstract}` : '（无摘要，仅元数据）'
    ];
    if (hasFulltext) parts.push(`全文要点（用户上传 PDF 提取）：\n${fulltext}`);
    const litBlock = parts.filter(Boolean).join('\n');

    const instruction = hasFulltext
      ? '基于全文（用户上传 PDF 提取的文本）进行批判性分析。'
      : '⚠ 本文仅有摘要（或仅元数据），未获取全文。基于摘要进行预筛级分析，并在输出开头注明“基于摘要分析（未获取全文）”，对推断性内容明确标注“待全文验证”。';

    const prompt = `你是科研论文评审专家。对以下论文进行批判性分析。\n${instruction}\n\n${litBlock}\n\n请用 Markdown 输出以下结构：\n## 核心研究问题与假设\n## 关键方法及设计理由\n## 数据与实验设置\n## 作者结论及证据支持程度\n## 方法局限与可能的反例\n## 可迁移的思路\n## 对本项目的启示\n\n要求：只基于给定信息分析，不得编造数据或文献；信息不足处写“待补充”。`;

    const ctrl = new AbortController();
    if (req.body && req.body.jobId) jobs.register(req.body.jobId, ctrl);
    let analysis;
    try {
      analysis = await chatOnce(settings, [
        { role: 'system', content: '你是严谨的科研论文评审助手。' },
        { role: 'user', content: prompt }
      ], { signal: ctrl.signal, maxTokens: 2200, temperature: 0.3 });
    } finally {
      if (req.body && req.body.jobId) jobs.remove(req.body.jobId);
    }
    db.prepare('UPDATE literatures SET analysis = ? WHERE id = ?').run(analysis, req.params.lid);
    res.json({ id: req.params.lid, analysis });
  } catch (e) {
    next(e);
  }
});

// ---------- 上传 PDF 补充全文 ----------
router.post('/literatures/:lid/fulltext', upload.single('file'), async (req, res, next) => {
  try {
    const row = db.prepare('SELECT * FROM literatures WHERE id = ?').get(req.params.lid);
    if (!row) return res.status(404).json({ error: '文献不存在' });
    if (!req.file) return res.status(400).json({ error: '未收到文件' });
    const filePath = req.file.path;
    let text = '';
    let extracted = false;
    let message = '';
    try {
      text = await extractPdfText(filePath);
      extracted = !!text;
    } catch (e) {
      message = 'PDF 文本提取失败：' + (e.message || e);
    }
    const txtPath = filePath + '.txt';
    if (text) fs.writeFileSync(txtPath, text);
    db.prepare('UPDATE literatures SET fulltext_path = ?, status = ?, note = ? WHERE id = ?')
      .run(text ? txtPath : filePath, 'fulltext_obtained', message, req.params.lid);
    res.json({ ok: true, extracted, chars: text.length, message });
  } catch (e) {
    next(e);
  }
});

module.exports = { router, normalizeItem };
