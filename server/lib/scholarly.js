'use strict';
// 真实学术数据源：OpenAlex 为主、Crossref 兜底。仅返回真实检索到的论文元数据，
// 绝不生成/伪造论文标题。abstract 来自数据源；全文需用户上传 PDF 后提取。

function rebuildAbstract(inv) {
  if (!inv || typeof inv !== 'object') return null;
  const pos = [];
  for (const [word, idxs] of Object.entries(inv)) {
    if (!Array.isArray(idxs)) continue;
    for (const i of idxs) pos[i] = word;
  }
  const text = pos.filter(Boolean).join(' ');
  return text || null;
}

function stripXml(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function searchOpenAlex(query, { from, to, perPage = 25 } = {}) {
  const p = new URLSearchParams();
  p.set('search', query);
  p.set('per-page', String(perPage));
  p.set('mailto', 'researchgrant-studio@localhost');
  const filters = [];
  if (from) filters.push(`from_publication_date:${from}-01-01`);
  if (to) filters.push(`to_publication_date:${to}-12-31`);
  if (filters.length) p.set('filter', filters.join(','));
  const res = await fetch(`https://api.openalex.org/works?${p}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(25000)
  });
  if (!res.ok) throw new Error(`OpenAlex HTTP ${res.status}`);
  const data = await res.json();
  const results = data.results || [];
  return results.map((w) => {
    const doi = (w.doi || '').replace(/^https?:\/\/doi\.org\//, '');
    const workId = String(w.id || '').split('/').pop();
    return {
      title: (w.title || '').trim(),
      authors: (w.authorships || []).map((a) => a.author && a.author.display_name).filter(Boolean),
      year: w.publication_year || null,
      doi,
      url: w.doi || (w.primary_location && w.primary_location.landing_page_url) || `https://openalex.org/${workId}`,
      abstract: rebuildAbstract(w.abstract_inverted_index),
      source: 'OpenAlex',
      cited_by: w.cited_by_count || 0,
      fulltext_url:
        (w.best_oa_location && (w.best_oa_location.pdf_url || w.best_oa_location.landing_page_url)) ||
        (w.open_access && w.open_access.oa_url) ||
        ''
    };
  }).filter((x) => x.title);
}

async function searchCrossref(query, { from, to, rows = 25 } = {}) {
  const p = new URLSearchParams();
  p.set('query', query);
  p.set('rows', String(rows));
  p.set('select', 'DOI,title,author,issued,type,abstract,URL,is-referenced-by-count');
  const filters = [];
  if (from) filters.push(`from-pub-date:${from}-01-01`);
  if (to) filters.push(`until-pub-date:${to}-12-31`);
  if (filters.length) p.set('filter', filters.join(','));
  const res = await fetch(`https://api.crossref.org/works?${p}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(25000)
  });
  if (!res.ok) throw new Error(`Crossref HTTP ${res.status}`);
  const data = await res.json();
  const items = (data.message && data.message.items) || [];
  const noiseTypes = new Set(['component', 'dataset', 'reference-entry', 'peer-review', 'standard', 'report-component']);
  return items.map((it) => {
    const type = it.type || '';
    const title = ((it.title && it.title[0]) || '').trim();
    return {
      title,
      authors: (it.author || []).map((a) => [a.given, a.family].filter(Boolean).join(' ')),
      year: it.issued && it.issued['date-parts'] && it.issued['date-parts'][0]
        ? it.issued['date-parts'][0][0]
        : null,
      doi: it.DOI || '',
      url: it.URL || (it.DOI ? `https://doi.org/${it.DOI}` : ''),
      abstract: stripXml(it.abstract),
      source: 'Crossref',
      cited_by: it['is-referenced-by-count'] || 0,
      fulltext_url: '',
      _noise: noiseTypes.has(type) || !title || /supplement/i.test(title)
    };
  }).filter((x) => x.title && !x._noise);
}

function normTitle(t) {
  return String(t || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');
}

function mergeResults(lists) {
  const seen = new Map();
  const out = [];
  for (const list of lists) {
    for (const item of list) {
      if (!item.title) continue;
      const key = item.doi ? `doi:${item.doi.toLowerCase()}` : `t:${normTitle(item.title)}`;
      if (seen.has(key)) continue;
      seen.set(key, true);
      out.push(item);
    }
  }
  return out;
}

module.exports = { searchOpenAlex, searchCrossref, mergeResults, normTitle };
