'use strict';
const express = require('express');
const { db } = require('../db');
const { buildMarkdownBundle, buildRefsMarkdown, buildRefsCsv, markdownToDocx } = require('../lib/exporter');

const router = express.Router();

function sanitize(name) {
  return String(name || '导出').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60);
}

router.get('/projects/:id/export', async (req, res, next) => {
  try {
    const format = req.query.format || 'md';
    const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    if (!p) return res.status(404).json({ error: '项目不存在' });
    const literatures = db.prepare('SELECT * FROM literatures WHERE project_id = ? ORDER BY year DESC, title').all(req.params.id);
    const artifacts = db.prepare('SELECT * FROM artifacts WHERE project_id = ? ORDER BY created_at').all(req.params.id)
      .map((a) => ({ ...a, meta: JSON.parse(a.meta || '{}') }));
    const todos = db.prepare('SELECT * FROM todos WHERE project_id = ? ORDER BY status, created_at').all(req.params.id);
    const base = `ResearchGrant_${sanitize(p.name)}`;

    if (format === 'docx') {
      const md = buildMarkdownBundle({ project: p, literatures, artifacts, todos });
      const refs = literatures.filter((l) => l.status !== 'metadata_only');
      const buffer = await markdownToDocx(md, refs);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(base + '.docx')}`);
      res.send(Buffer.from(buffer));
      return;
    }
    if (format === 'refs') {
      const refFormat = req.query.refFormat || 'md';
      if (refFormat === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(base + '_文献清单.csv')}`);
        res.send('\uFEFF' + buildRefsCsv(literatures));
      } else {
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(base + '_文献清单.md')}`);
        res.send(buildRefsMarkdown(literatures));
      }
      return;
    }
    // markdown
    const md = buildMarkdownBundle({ project: p, literatures, artifacts, todos });
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(base + '.md')}`);
    res.send(md);
  } catch (e) { next(e); }
});

module.exports = { router };
