'use strict';
// 成果导出：Markdown / DOCX（按中文科研申报书排版：宋体正文/黑体标题/GB-T 7714 参考文献）/ 文献清单。
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, AlignmentType, BorderStyle, InternalHyperlink, Bookmark
} = require('docx');

const FONT_BODY = { ascii: 'Times New Roman', eastAsia: '宋体' };
const FONT_HEAD = { ascii: 'Times New Roman', eastAsia: '黑体' };

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseAuthors(l) {
  try {
    const a = JSON.parse(l.authors || '[]');
    return Array.isArray(a) ? a : [];
  } catch (e) { return []; }
}

// 西文作者转 GB/T 7714：姓在前，名缩写。"Xing-An Liu" -> "Liu X A"；中文作者原样保留。
function authorGbt(name) {
  const s = String(name || '').trim();
  if (!s) return '';
  if (/[一-龥]/.test(s)) return s;
  const parts = s.split(/\s+/);
  if (parts.length < 2) return s;
  const surname = parts[parts.length - 1];
  const initials = parts.slice(0, -1)
    .map((p) => p.replace(/[^A-Za-z]/g, '').charAt(0).toUpperCase())
    .filter(Boolean).join(' ');
  return initials ? `${surname} ${initials}` : surname;
}

// GB/T 7714 期刊条目：[1] Liu X A, Doe J, Smith A B, et al. Title[J]. 2026. DOI: xxx.
function litGbt(l, i) {
  const authors = parseAuthors(l);
  const a = authors.length > 3
    ? authors.slice(0, 3).map(authorGbt).join(', ') + ', et al.'
    : authors.map(authorGbt).join(', ');
  const title = String(l.title || '').replace(/\s+.$/, '');
  let s = `[${i}]${a ? ' ' + a + '.' : ''} ${title}[J].`;
  if (l.year) s += ` ${l.year}.`;
  if (l.doi) s += ` DOI: ${l.doi}.`;
  return s;
}

// 兼容旧调用
function litRef(l, i) { return litGbt(l, i); }

// ---------- Markdown 组装 ----------
function buildMarkdownBundle(bundle) {
  const { project, literatures, artifacts, todos } = bundle;
  const lines = [];
  lines.push(`# ${project.name}`);
  lines.push('');
  lines.push(`> 申报类型：${project.grant_type}｜申报年度：${project.year || '—'}｜研究方向：${project.direction || '—'}`);
  if (project.foundation) lines.push(`>\n> 已有研究基础：${project.foundation}`);
  lines.push('');

  const byKind = (kind, stage) => artifacts.filter((a) => a.kind === kind && (stage == null || a.stage === stage));
  const latest = (kind, stage) => {
    const arr = byKind(kind, stage).sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
    return arr[0];
  };

  const report = latest('report', 1);
  if (report) {
    lines.push('## 一、研究现状报告');
    lines.push('');
    lines.push(report.content || '（空）');
    lines.push('');
  }

  lines.push('## 二、文献证据库');
  lines.push('');
  const verified = literatures.filter((l) => l.status !== 'metadata_only');
  if (verified.length === 0) {
    lines.push('（暂无可核验文献）');
  } else {
    verified.forEach((l, i) => lines.push(litGbt(l, i + 1)));
  }
  lines.push('');

  const matrix = latest('matrix', 2);
  const questions = byKind('question', 2).filter((q) => q.confirmed === 1);
  if (matrix) {
    lines.push('## 三、研究论证');
    lines.push('');
    lines.push(matrix.content || '（空）');
    lines.push('');
  }
  if (questions.length) {
    lines.push('## 四、确认的科学问题（进入申报）');
    lines.push('');
    questions.forEach((q, i) => {
      lines.push(`${i + 1}. **${q.title || '未命名问题'}**`);
      lines.push(q.content || '');
    });
    lines.push('');
  }

  const chapters = artifacts
    .filter((a) => a.kind === 'chapter')
    .sort((a, b) => (a.meta && b.meta ? String(a.meta.chapterId).localeCompare(String(b.meta.chapterId), undefined, { numeric: true }) : 0));
  if (chapters.length) {
    lines.push('## 五、申报书正文');
    lines.push('');
    chapters.forEach((c) => {
      lines.push(`### ${c.title}`);
      lines.push('');
      lines.push(c.content || '（空）');
      lines.push('');
    });
  }

  if (verified.length) {
    lines.push('## 六、参考文献');
    lines.push('');
    verified.forEach((l, i) => lines.push(litGbt(l, i + 1)));
    lines.push('');
  }

  if (todos && todos.length) {
    lines.push('## 附：待确认事项');
    lines.push('');
    todos.forEach((t) => lines.push(`- [${t.status === 'done' ? 'x' : ' '}] ${t.text}`));
  }

  return lines.join('\n');
}

function buildRefsMarkdown(literatures) {
  const lines = ['# 文献清单', ''];
  literatures.forEach((l, i) => {
    lines.push(litGbt(l, i + 1));
    lines.push(`  - 来源：${l.source || '—'}｜核验状态：${statusLabel(l.status)}｜链接：${l.url || '—'}`);
  });
  return lines.join('\n');
}

function buildRefsCsv(literatures) {
  const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const head = ['序号', '标题', '作者', '年份', 'DOI', '来源', '核验状态', '链接'];
  const rows = literatures.map((l, i) => [
    i + 1, l.title, parseAuthors(l).join('; '), l.year, l.doi, l.source, statusLabel(l.status), l.url
  ].map(esc).join(','));
  return [head.map(esc).join(','), ...rows].join('\n');
}

function statusLabel(s) {
  return { metadata_only: '仅元数据', abstract_obtained: '已获取摘要', fulltext_obtained: '已获取全文' }[s] || s;
}

// ---------- Markdown → DOCX ----------
// 行内解析：**粗体** / *斜体* / `代码` / [n] 内部超链接（跳到参考文献书签）
function inlineRunsRich(text, base = {}) {
  const runs = [];
  const tokens = String(text).split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  for (const tok of tokens) {
    if (!tok) continue;
    let bold = false, italic = false, mono = false, plain = tok;
    if (tok.startsWith('**') && tok.endsWith('**')) { bold = true; plain = tok.slice(2, -2); }
    else if (tok.startsWith('`') && tok.endsWith('`')) { mono = true; plain = tok.slice(1, -1); }
    else if (tok.startsWith('*') && tok.endsWith('*') && tok.length > 2) { italic = true; plain = tok.slice(1, -1); }
    const parts = plain.split(/(\[\d+\])/g);
    for (const p of parts) {
      if (!p) continue;
      const m = p.match(/^\[(\d+)\]$/);
      if (m) {
        runs.push(new InternalHyperlink({
          anchor: `ref${m[1]}`,
          children: [new TextRun({ text: p, style: 'Hyperlink', font: FONT_BODY, size: 24, ...base })]
        }));
      } else if (mono) {
        runs.push(new TextRun({ text: p, font: 'Consolas', size: 21, ...base }));
      } else {
        runs.push(new TextRun({ text: p, bold, italics: italic, font: FONT_BODY, size: 24, ...base }));
      }
    }
  }
  return runs;
}

function mdToBlocks(md) {
  const lines = String(md || '').split('\n');
  const blocks = [];
  let i = 0;
  const inList = { type: null, items: [] };
  const flushList = () => {
    if (inList.items.length) {
      blocks.push({ list: inList.items.slice(), ordered: inList.type === 'ol' });
      inList.items = [];
      inList.type = null;
    }
  };
  while (i < lines.length) {
    const line = lines[i].trimEnd();
    const trimmed = line.trim();
    if (!trimmed) { i++; continue; }
    const h = trimmed.match(/^(#{1,6})\s+(.*)/);
    if (h) {
      flushList();
      blocks.push({ heading: h[1].length, text: h[2] });
      i++; continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) { flushList(); blocks.push({ hr: true }); i++; continue; }
    if (/^\s*[-*+]\s+/.test(trimmed)) { inList.type = 'ul'; inList.items.push(trimmed.replace(/^\s*[-*+]\s+/, '')); i++; continue; }
    if (/^\s*\d+[.、)]\s+/.test(trimmed)) { inList.type = 'ol'; inList.items.push(trimmed.replace(/^\s*\d+[.、)]\s+/, '')); i++; continue; }
    flushList();
    if (/^\|/.test(trimmed) && /\|$/.test(trimmed)) {
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i].trim()) && /\|$/.test(lines[i].trim())) {
        rows.push(lines[i].trim().split('|').slice(1, -1).map((c) => c.trim()));
        i++;
      }
      if (rows.length > 1 && rows[1].every((c) => /^:?-{2,}:?$/.test(c))) rows.splice(1, 1);
      blocks.push({ table: rows });
      continue;
    }
    if (trimmed.startsWith('>')) { blocks.push({ quote: trimmed.replace(/^>\s?/, '') }); i++; continue; }
    const para = [trimmed];
    i++;
    while (i < lines.length) {
      const nxt = lines[i].trim();
      if (!nxt) break;
      if (/^(#{1,6})\s/.test(nxt)) break;
      if (/^\s*[-*+]\s+/.test(nxt)) break;
      if (/^\s*\d+[.、)]\s+/.test(nxt)) break;
      if (/^\[\d+\]\s/.test(nxt)) break;
      if (/^\|/.test(nxt)) break;
      if (nxt.startsWith('>')) break;
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(nxt)) break;
      para.push(nxt);
      i++;
    }
    blocks.push({ para: para.join(' ') });
  }
  flushList();
  return blocks;
}

async function markdownToDocx(md, references = []) {
  let blocks = mdToBlocks(md);
  // 丢弃自动生成的参考文献段落，改用带书签的渲染（支持正文超链接跳转）
  const kept = [];
  let skipping = false;
  for (const b of blocks) {
    if (b.heading && /参考文献/.test(b.text)) { skipping = true; continue; }
    if (skipping) { if (b.heading) { skipping = false; kept.push(b); } continue; }
    kept.push(b);
  }
  blocks = kept;

  const children = [];
  const HEADING_SIZE = { 1: 44, 2: 30, 3: 28, 4: 24, 5: 24 }; // 二号/小三/四号/小四
  for (const b of blocks) {
    if (b.heading) {
      const level = Math.min(b.heading, 5);
      const isTitle = level === 1;
      children.push(new Paragraph({
        alignment: isTitle ? AlignmentType.CENTER : AlignmentType.START,
        spacing: { before: isTitle ? 0 : 240, after: 120, line: 360 },
        children: [new TextRun({ text: b.text, bold: true, font: FONT_HEAD, size: HEADING_SIZE[level] || 24 })]
      }));
    } else if (b.para) {
      children.push(new Paragraph({
        spacing: { after: 0, line: 360 },
        indent: { firstLine: 480 },
        children: inlineRunsRich(b.para)
      }));
    } else if (b.quote) {
      children.push(new Paragraph({
        spacing: { after: 0, line: 360 },
        indent: { left: 480 },
        children: inlineRunsRich(b.quote, { color: '595959' })
      }));
    } else if (b.list) {
      b.list.forEach((item) => {
        children.push(new Paragraph({
          spacing: { after: 0, line: 360 },
          indent: { left: 480, hanging: 240 },
          children: inlineRunsRich(item)
        }));
      });
    } else if (b.table) {
      const rows = b.table.map((row, ri) => new TableRow({
        children: row.map((cell) => new TableCell({
          children: [new Paragraph({
            spacing: { line: 300 },
            children: [new TextRun({ text: cell, font: FONT_BODY, size: 20, bold: ri === 0 })]
          })],
          shading: ri === 0 ? { fill: 'F2F2F2' } : undefined
        }))
      }));
      children.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows,
        borders: {
          top: { style: BorderStyle.SINGLE, size: 4, color: '808080' },
          bottom: { style: BorderStyle.SINGLE, size: 4, color: '808080' },
          left: { style: BorderStyle.SINGLE, size: 4, color: '808080' },
          right: { style: BorderStyle.SINGLE, size: 4, color: '808080' },
          insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' },
          insideVertical: { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' }
        }
      }));
      children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
    } else if (b.hr) {
      children.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'BFBFBF' } }, children: [] }));
    }
  }

  // 参考文献（带书签，正文 [n] 可跳转）
  if (references.length) {
    children.push(new Paragraph({
      spacing: { before: 240, after: 120, line: 360 },
      children: [new TextRun({ text: '参考文献', bold: true, font: FONT_HEAD, size: 28 })]
    }));
    references.forEach((l, i) => {
      children.push(new Paragraph({
        spacing: { after: 60, line: 320 },
        indent: { left: 480, hanging: 480 },
        children: [
          new Bookmark({
            id: `ref${i + 1}`,
            children: [new TextRun({ text: litGbt(l, i + 1), font: FONT_BODY, size: 21 })]
          })
        ]
      }));
    });
  }

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT_BODY, size: 24 } } } },
    sections: [{
      properties: {
        page: { margin: { top: 1440, bottom: 1440, left: 1800, right: 1440 } }
      },
      children
    }]
  });
  return Packer.toBuffer(doc);
}

module.exports = { buildMarkdownBundle, buildRefsMarkdown, buildRefsCsv, markdownToDocx };
