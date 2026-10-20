# ResearchGrant Studio — 科研项目申报智能工作台

面向科研人员、高校教师和企业研发人员的 AI 项目申报辅助平台。以「文献调研 → 研究论证 → 申报写作」三阶段工作流，把检索到的真实文献、AI 分析与人工确认沉淀到项目上下文，最终产出申报书章节并可导出 Word / Markdown。

暗色、克制的生产力工具风格（参考 Linear / Notion 设计语言），桌面浏览器优先、兼容窄屏。

---

## 一、技术栈与架构

```
research-grant-studio/
├─ server/                 Node.js + Express 后端（端口 4321）
│  ├─ index.js             服务入口、静态托管、上传
│  ├─ db.js                SQLite（better-sqlite3）+ 内置申报模板
│  ├─ lib/                 AI 适配 / 学术检索 / 导出 / 密钥加密 / 任务注册
│  └─ routes/              项目、设置、文献、三阶段工作流、导出
├─ client/                 React 18 + Vite 前端（构建产物由后端托管）
│  └─ src/pages/           首页工作台 / 项目工作区 / 设置
└─ data/                   运行时生成：SQLite 数据库、上传文件、密钥
```

- 数据持久化：本地 SQLite（`data/rgs.db`），刷新/重启不丢失。
- AI 调用：统一封装 OpenAI / DeepSeek / 豆包（火山方舟）/ 自定义 OpenAI 兼容接口，全部走服务端代理。
- API Key：AES-256-GCM 加密后仅存于本机 `data/` 目录，**不写入浏览器存储、不写入日志**；回显仅显示掩码。
- 文献：真实调用 OpenAlex + Crossref 公开学术接口；**AI 只负责生成检索策略与分析，绝不生成论文标题**。

## 二、安装与启动

前置：Node.js ≥ 18（已验证 Node v20）。

```bash
# 1. 安装依赖（根目录与 client 目录）
npm run setup

# 2. 构建前端并启动（生产模式，单端口）
npm run build
npm start
# 打开 http://localhost:4321

# 开发模式（可选）：后端 4321 + Vite 热更新 5173
npm run dev:server   # 终端 1
npm run dev:client   # 终端 2，打开 http://localhost:5173
```

> Windows 下如果默认 npm 镜像不可达：`npm config set registry https://registry.npmjs.org` 后重试。

## 三、AI 配置与使用

1. 打开「设置 → AI 模型」。
2. 选择服务商（OpenAI / DeepSeek / 豆包 / 自定义），Base URL 自动预填，可改。
3. 填入 API Key 与模型名称（各服务商模型 ID 不同，按官方文档填写）。
4. 点击「测试连接」验证 →「保存配置」。

| 服务商 | Base URL（默认） | 模型示例 |
|---|---|---|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o`、`gpt-4o-mini` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat`、`deepseek-reasoner` |
| 豆包（火山方舟） | `https://ark.cn-beijing.volces.com/api/v3` | `doubao-seed-1-6-250615`（或 endpoint ID） |
| 自定义 | 你的 OpenAI 兼容 Base URL | 按服务商文档 |

注意：不同服务商接口细节存在差异（模型 ID、限流、错误码），本系统按 `/chat/completions` 协议统一适配并在调用失败时给出可读错误。文献检索不依赖 AI：未配置模型时使用内置关键词检索策略并明确标注。

## 四、三阶段工作流

- **Step 1 文献调研**：填主题/年份/研究重点 →「生成检索策略并检索」（OpenAlex+Crossref 真实检索、DOI 去重、摘要核验）→ 逐篇「AI 分析」→「生成研究现状报告」→ 勾选核心论文 →「完成并进入研究论证」。
- **Step 2 研究论证**：对核心论文逐篇批判性分析（仅摘要时明确标注"未获取全文"）→「跨论文分析」生成对比矩阵、共同局限、候选科学问题（含支持证据/最强反对意见/未验证条件）→ 人工确认/修改/否决问题 →「完成并进入申报写作」。**对比矩阵为可编辑表格**：点击「待补充」单元格可直接手动补充内容并保存。
- **Step 3 申报写作**：按申报类型模板（国自然面上 / 科技研发 / 通用）分章节写作；AI 可生成草稿或（受限模式下）仅生成提纲与论证材料；支持扩写/精简/润色/续写/检查、插入文献引用、保存版本与恢复、全章节逻辑一致性检查；项目资料（PDF 等）上传后作为写作的真实依据，缺失信息 AI 必须标注"待补充"。

每个页面顶部有「下一步」引导条（含当前步骤高亮与缺项提示）；首页有全局「下一步」入口；所有 AI 耗时任务在按钮、侧栏与首页显示实时运行进度并可中止。

## 五、导出

首页或工作区右上角「导出成果」：
- Markdown（`.md`）：完整申报书 + 文献证据库 + 参考文献
- Word（`.docx`）：保留标题层级、段落、表格、参考文献结构
- 文献清单（`.md` / `.csv`）

## 六、主要接口（供集成参考）

| 接口 | 说明 |
|---|---|
| `POST /api/projects` | 创建项目 |
| `GET /api/projects/:id` | 项目详情 + 统计 |
| `PUT /api/settings` / `POST /api/settings/test` | 保存 / 测试 AI 配置 |
| `POST /api/projects/:id/stage1/run` | 生成检索策略 + 真实检索 |
| `POST /api/projects/:id/stage1/report` | 生成研究现状报告与候选问题 |
| `POST /api/literatures/:lid/analyze` | 单篇批判性分析 |
| `POST /api/projects/:id/stage2/cross` | 跨论文分析 |
| `POST /api/projects/:id/stage3/generate` | 章节生成（SSE 流式） |
| `POST /api/projects/:id/stage3/assist` | 章节 AI 辅助（SSE 流式） |
| `GET /api/projects/:id/export?format=md|docx|refs` | 导出 |

## 七、安全与隐私说明

- API Key 只存在于本机 `data/` 目录（AES-256-GCM 加密，密钥文件 `data/.secret`），仅在你授权的调用中发送给对应服务商。
- 不上传任何数据到第三方服务器（除你配置的模型服务商与公开学术检索接口外）。
- 删除项目会级联删除其文献、成果、上传文件。

## 八、验收与测试结果

`test-api.ps1` 端到端测试（真实服务 + 真实学术检索接口），全部 10 步通过：

| # | 测试项 | 结果 |
|---|---|---|
| 1 | 创建项目（内置模板关联、阶段初始态） | ✅ |
| 2 | 未配置 API Key 时 AI 调用错误路径（可读中文提示） | ✅ |
| 3 | 真实文献检索（OpenAlex 主 + Crossref 兜底、DOI/标题去重、噪声过滤） | ✅ 单次检索新增 8 篇 |
| 4 | 勾选核心论文并完成阶段一 → 阶段二流转 | ✅ |
| 5 | 人工编辑文献备注持久化 | ✅ |
| 6 | 阶段三模板结构（11 章节 + 已确认文献注入） | ✅ |
| 7 | 章节保存 / 版本快照 / 恢复 | ✅ |
| 8 | 待确认事项自动生成与查询 | ✅ |
| 9 | 导出 Markdown / DOCX（PK 签名校验）/ 文献清单 md+csv | ✅ |
| 10 | 首页统计（已核验文献 / 候选问题 / 待确认 / 最近成果） | ✅ |

UI 走查（浏览器实测）：首页工作台、三阶段工作区、设置页均正常渲染；阶段间数据共享（阶段一勾选的 2 篇核心论文在阶段二直接可见）、章节树与编辑操作可用；刷新后数据不丢失（SQLite 持久化）。

## 九、已知限制

- 全文精读依赖用户上传 PDF（`pdf-parse` 提取文本）；扫描版 PDF 可能提取失败，会明确提示。
- **AI 真实成功调用需要用户配置自己的 API Key**：`设置 → AI 模型 → 测试连接` 通过后，检索策略、研究现状报告、批判性分析、章节草稿等才会真实调用模型；未配置时给出明确错误提示，绝不伪造生成结果。
- **OpenAlex 免费额度可能被限流（HTTP 429）**：此时自动回退 Crossref（真实元数据仍可用，摘要可能缺失），策略卡会显示「OpenAlex 暂不可用，结果来自 Crossref」提示；可稍后重试或配置 OpenAlex 免费 API Key。
- 未实现账号/多人协作/云端同步（按需求仅本地单机 MVP）。
- 各年度申报规范以官方最新指南为准；内置模板结构与提示词可在「设置 → 申报模板」编辑并另存为自定义模板，不将任何年度的规则写死。
