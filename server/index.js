'use strict';
const path = require('path');
const fs = require('fs');
const express = require('express');
const { db, UPLOAD_DIR } = require('./db');
const { router: coreRouter, getAISettings, uid, now } = require('./routes/core');
const { router: litRouter } = require('./routes/literature');
const { router: workflowRouter } = require('./routes/workflow');
const { router: exportRouter } = require('./routes/export');
const { upload, extractPdfText } = require('./lib/upload');
const { ApiError } = require('./lib/ai');

const app = express();
app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ---------- 项目资料上传 ----------
app.post('/api/projects/:id/uploads', upload.single('file'), async (req, res, next) => {
  try {
    const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    if (!p) return res.status(404).json({ error: '项目不存在' });
    if (!req.file) return res.status(400).json({ error: '未收到文件' });
    const kind = (req.body && req.body.kind) || 'material';
    const filePath = req.file.path;
    let textPath = '';
    let chars = 0;
    let extracted = false;
    let message = '';
    if (/\.pdf$/i.test(req.file.originalname || '') || /\.pdf$/i.test(req.file.filename || '')) {
      try {
        const text = await extractPdfText(filePath);
        if (text) {
          textPath = filePath + '.txt';
          fs.writeFileSync(textPath, text);
          chars = text.length;
          extracted = true;
        }
      } catch (e) {
        message = 'PDF 文本提取失败：' + (e.message || e);
      }
    }
    const id = uid();
    db.prepare('INSERT INTO uploads (id, project_id, filename, stored_name, kind, size, text_path, created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, req.params.id, req.file.originalname || req.file.filename, req.file.filename, kind, req.file.size, textPath, now());
    res.json(db.prepare('SELECT * FROM uploads WHERE id = ?').get(id));
  } catch (e) { next(e); }
});

app.get('/api/projects/:id/uploads', (req, res) => {
  res.json(db.prepare('SELECT * FROM uploads WHERE project_id = ? ORDER BY created_at DESC').all(req.params.id));
});

app.get('/api/uploads/:id/download', (req, res) => {
  const u = db.prepare('SELECT * FROM uploads WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: '文件不存在' });
  const filePath = path.join(UPLOAD_DIR, u.stored_name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '文件已被移动或删除' });
  res.download(filePath, u.filename);
});

app.get('/api/uploads/:id/text', (req, res) => {
  const u = db.prepare('SELECT * FROM uploads WHERE id = ?').get(req.params.id);
  if (!u || !u.text_path || !fs.existsSync(u.text_path)) return res.status(404).json({ error: '无可用文本' });
  res.json({ text: fs.readFileSync(u.text_path, 'utf8').slice(0, 60000), filename: u.filename });
});

// ---------- 挂载路由 ----------
app.use('/api', coreRouter);
app.use('/api', litRouter);
app.use('/api', workflowRouter);
app.use('/api', exportRouter);

// ---------- 静态前端 ----------
const dist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
}

// ---------- 错误处理 ----------
app.use((err, req, res, next) => {
  if (err instanceof ApiError) {
    return res.status(400).json({ error: err.message });
  }
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: '文件过大（上限 40MB）' });
  }
  if (err && err.name === 'MulterError') {
    return res.status(400).json({ error: '上传失败：' + err.message });
  }
  console.error('[server error]', err && err.message ? err.message : err);
  res.status(500).json({ error: '服务器内部错误：' + (err && err.message ? err.message : '未知错误') });
});

const PORT = process.env.PORT || 4321;
app.listen(PORT, () => {
  console.log(`ResearchGrant Studio 已启动：http://localhost:${PORT}`);
  console.log(`数据目录：${path.join(__dirname, '..', 'data')}`);
});
