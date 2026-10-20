import React, { useMemo } from 'react';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderInline(s) {
  let t = esc(s);
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return t;
}

export function renderMd(src) {
  let text = String(src || '');
  const fences = [];
  text = text.replace(/```(\w*)\n([\s\S]*?)```/g, (m, lang, code) => {
    fences.push(`<pre><code>${esc(code.replace(/^\n+|\n+$/g, ''))}</code></pre>`);
    return `\u0000F${fences.length - 1}\u0000`;
  });
  const lines = text.split('\n');
  const out = [];
  let i = 0;
  let list = null;
  const flush = () => {
    if (list) {
      out.push(`<${list.type}>`);
      for (const item of list.items) out.push(`<li>${item}</li>`);
      out.push(`</${list.type}>`);
      list = null;
    }
  };
  const isListLine = (t) => /^\s*[-*+]\s+/.test(t) || /^\s*\d+[.、)]\s+/.test(t);
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) { flush(); i++; continue; }
    const f = trimmed.match(/^\u0000F(\d+)\u0000$/);
    if (f) { flush(); out.push(fences[+f[1]]); i++; continue; }
    const h = trimmed.match(/^(#{1,6})\s+(.*)/);
    if (h) { flush(); const lv = h[1].length; out.push(`<h${lv}>${renderInline(h[2])}</h${lv}>`); i++; continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) { flush(); out.push('<hr/>'); i++; continue; }
    if (/^>\s?/.test(trimmed)) {
      flush();
      const q = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        const t2 = lines[i].trim().replace(/^>\s?/, '');
        if (t2) q.push(renderInline(t2));
        i++;
      }
      out.push(`<blockquote>${q.join('<br/>')}</blockquote>`);
      continue;
    }
    if (/^\|/.test(trimmed) && /\|$/.test(trimmed)) {
      flush();
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i].trim()) && /\|$/.test(lines[i].trim())) {
        rows.push(lines[i].trim().split('|').slice(1, -1).map((c) => c.trim()));
        i++;
      }
      if (rows.length > 1 && rows[1].every((c) => /^:?-{2,}:?$/.test(c))) rows.splice(1, 1);
      out.push('<table>');
      rows.forEach((r, ri) => {
        const tag = ri === 0 ? 'th' : 'td';
        out.push('<tr>' + r.map((c) => `<${tag}>${renderInline(c)}</${tag}>`).join('') + '</tr>');
      });
      out.push('</table>');
      continue;
    }
    if (/^\s*[-*+]\s+/.test(trimmed)) {
      if (!list || list.type !== 'ul') { flush(); list = { type: 'ul', items: [] }; }
      list.items.push(renderInline(trimmed.replace(/^\s*[-*+]\s+/, '')));
      i++; continue;
    }
    if (/^\s*\d+[.、)]\s+/.test(trimmed)) {
      if (!list || list.type !== 'ol') { flush(); list = { type: 'ol', items: [] }; }
      list.items.push(renderInline(trimmed.replace(/^\s*\d+[.、)]\s+/, '')));
      i++; continue;
    }
    flush();
    if (isListLine(lines[i + 1] || '')) {
      out.push(`<p>${renderInline(trimmed)}</p>`);
      i++; continue;
    }
    const para = [trimmed];
    i++;
    while (i < lines.length) {
      const nxt = lines[i].trim();
      if (!nxt || /^(#{1,6})\s/.test(nxt) || /^\|/.test(nxt) || isListLine(nxt) || nxt.startsWith('>') || /^(-{3,}|\*{3,}|_{3,})$/.test(nxt) || /^\u0000F\d+\u0000$/.test(nxt)) break;
      para.push(nxt);
      i++;
    }
    out.push(`<p>${para.map(renderInline).join('<br/>')}</p>`);
  }
  flush();
  return out.join('\n');
}

export default function Markdown({ text, className = '' }) {
  const html = useMemo(() => renderMd(text), [text]);
  return <div className={`md ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
