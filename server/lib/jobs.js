'use strict';
// 进行中 AI 任务的注册表：用于“中止生成”。
const jobs = new Map();

module.exports = {
  register(id, ctrl) { jobs.set(id, ctrl); },
  abort(id) { const c = jobs.get(id); if (c) { try { c.abort(); } catch (e) {} } },
  remove(id) { jobs.delete(id); }
};
