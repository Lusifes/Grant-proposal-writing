'use strict';
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'rgs.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  direction TEXT DEFAULT '',
  grant_type TEXT DEFAULT '通用项目申请书',
  template_id TEXT DEFAULT 'general',
  year TEXT DEFAULT '',
  foundation TEXT DEFAULT '',
  requirements TEXT DEFAULT '',
  ai_mode TEXT DEFAULT 'restricted',
  stage1 TEXT DEFAULT 'not_started',
  stage2 TEXT DEFAULT 'not_started',
  stage3 TEXT DEFAULT 'not_started',
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT DEFAULT 'builtin',
  structure TEXT NOT NULL,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS literatures (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  authors TEXT DEFAULT '[]',
  year INTEGER,
  doi TEXT DEFAULT '',
  source TEXT DEFAULT '',
  url TEXT DEFAULT '',
  abstract TEXT DEFAULT '',
  status TEXT DEFAULT 'metadata_only',
  fulltext_path TEXT DEFAULT '',
  fulltext_url TEXT DEFAULT '',
  analysis TEXT DEFAULT '',
  selected INTEGER DEFAULT 0,
  note TEXT DEFAULT '',
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage INTEGER NOT NULL,
  kind TEXT DEFAULT 'doc',
  title TEXT NOT NULL,
  content TEXT DEFAULT '',
  version INTEGER DEFAULT 1,
  confirmed INTEGER DEFAULT 0,
  meta TEXT DEFAULT '{}',
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS versions (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  content TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage INTEGER DEFAULT 1,
  text TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  kind TEXT DEFAULT 'material',
  size INTEGER DEFAULT 0,
  text_path TEXT DEFAULT '',
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_lit_project ON literatures(project_id);
CREATE INDEX IF NOT EXISTS idx_art_project ON artifacts(project_id);
CREATE INDEX IF NOT EXISTS idx_todo_project ON todos(project_id);
CREATE INDEX IF NOT EXISTS idx_upload_project ON uploads(project_id);
`);

// ---------- 内置模板 ----------
const TEMPLATES = {
  nsfc_face: {
    name: '国家自然科学基金面上项目',
    structure: [
      { id: 'c1', title: '项目摘要', guide: '400 字以内：研究背景、科学问题、研究内容、预期成果；突出创新性。', prompt: '撰写项目摘要草稿' },
      { id: 'c2', title: '立项依据（研究意义）', guide: '研究意义（科学意义、应用价值、国家需求）＋结合科研发展规律论述。', prompt: '起草“立项依据（研究意义）”章节' },
      { id: 'c3', title: '国内外研究现状与发展动态', guide: '综述国内外研究现状，指出发展动态、存在问题与研究空白，结合本项目研究内容论述。', prompt: '起草“国内外研究现状与发展动态”章节，引用已核验文献' },
      { id: 'c4', title: '研究内容', guide: '明确研究内容及其逻辑关系（递进/并列）。', prompt: '起草“研究内容”章节' },
      { id: 'c5', title: '研究目标与拟解决的关键科学问题', guide: '凝练研究目标与 2-3 个关键科学问题（须来自第二阶段确认的问题）。', prompt: '起草“研究目标与关键科学问题”章节' },
      { id: 'c6', title: '研究方案与技术路线', guide: '详述研究方案、技术路线（可用文字描述）、关键实验/方法。', prompt: '起草“研究方案与技术路线”章节' },
      { id: 'c7', title: '可行性分析', guide: '从理论、方法、数据/材料、团队与条件角度分析可行性。', prompt: '起草“可行性分析”章节' },
      { id: 'c8', title: '特色与创新之处', guide: '说明项目特色与创新点（与已有研究区分）。', prompt: '起草“特色与创新之处”章节' },
      { id: 'c9', title: '年度研究计划与预期成果', guide: '分年度计划（如第 1-4 年）与预期成果（论文、专利、数据等）。', prompt: '起草“年度研究计划与预期成果”章节' },
      { id: 'c10', title: '研究基础与工作条件', guide: '研究基础、已积累的数据/方法/设备条件；只使用用户提供的真实资料，缺失项写“待补充”。', prompt: '起草“研究基础与工作条件”章节' },
      { id: 'c11', title: '经费预算说明', guide: '按科目说明经费预算及测算依据；只依据用户提供的真实资料，缺失写“待补充”。', prompt: '起草“经费预算说明”章节' }
    ]
  },
  rnd_project: {
    name: '科技研发项目',
    structure: [
      { id: 'c1', title: '项目概述', guide: '项目背景、总体目标、预期效益概述。', prompt: '起草“项目概述”章节' },
      { id: 'c2', title: '国内外技术现状与发展趋势', guide: '国内外技术现状、差距与发展趋势，引用已核验文献。', prompt: '起草“国内外技术现状与发展趋势”章节' },
      { id: 'c3', title: '研究内容与技术方案', guide: '研究内容分解与技术方案描述。', prompt: '起草“研究内容与技术方案”章节' },
      { id: 'c4', title: '技术路线与实施方案', guide: '技术路线、实施步骤与里程碑。', prompt: '起草“技术路线与实施方案”章节' },
      { id: 'c5', title: '创新点与先进性', guide: '创新点、与现有技术的差异及先进性分析。', prompt: '起草“创新点与先进性”章节' },
      { id: 'c6', title: '考核指标与预期成果', guide: '可考核的技术指标、成果形式（专利、样机、软著、论文等）。', prompt: '起草“考核指标与预期成果”章节' },
      { id: 'c7', title: '进度安排', guide: '分阶段进度计划与里程碑节点。', prompt: '起草“进度安排”章节' },
      { id: 'c8', title: '研究基础与团队条件', guide: '研究基础、团队组成与设备条件；只使用真实资料，缺失写“待补充”。', prompt: '起草“研究基础与团队条件”章节' },
      { id: 'c9', title: '经费预算与保障', guide: '经费预算、来源与保障措施；只使用真实资料，缺失写“待补充”。', prompt: '起草“经费预算与保障”章节' }
    ]
  },
  general: {
    name: '通用项目申请书',
    structure: [
      { id: 'c1', title: '项目名称与摘要', guide: '项目名称 + 300-500 字摘要。', prompt: '起草“项目名称与摘要”章节' },
      { id: 'c2', title: '立项依据', guide: '研究背景与意义、立项的必要性。', prompt: '起草“立项依据”章节' },
      { id: 'c3', title: '研究内容与目标', guide: '研究内容、研究目标及拟解决的问题。', prompt: '起草“研究内容与目标”章节' },
      { id: 'c4', title: '研究方案与技术路线', guide: '研究方案、技术路线与关键方法。', prompt: '起草“研究方案与技术路线”章节' },
      { id: 'c5', title: '可行性分析', guide: '技术、方法、条件可行性分析。', prompt: '起草“可行性分析”章节' },
      { id: 'c6', title: '创新点', guide: '项目创新点及与现有工作的区别。', prompt: '起草“创新点”章节' },
      { id: 'c7', title: '研究计划与预期成果', guide: '时间计划与预期成果。', prompt: '起草“研究计划与预期成果”章节' },
      { id: 'c8', title: '研究基础', guide: '已有研究基础与工作条件；只使用真实资料，缺失写“待补充”。', prompt: '起草“研究基础”章节' },
      { id: 'c9', title: '经费与保障条件', guide: '经费预算与保障条件；只使用真实资料，缺失写“待补充”。', prompt: '起草“经费与保障条件”章节' }
    ]
  }
};

function seedTemplates() {
  const ins = db.prepare(
    'INSERT OR IGNORE INTO templates (id, name, kind, structure, created_at) VALUES (?, ?, ?, ?, ?)'
  );
  for (const [id, t] of Object.entries(TEMPLATES)) {
    ins.run(id, t.name, 'builtin', JSON.stringify(t.structure), new Date().toISOString());
  }
}
seedTemplates();

module.exports = { db, DATA_DIR, UPLOAD_DIR, TEMPLATES };
