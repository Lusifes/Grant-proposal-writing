import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from './api.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export const STAGE_STATUS = {
  not_started: { label: '未开始', tone: '' },
  in_progress: { label: '进行中', tone: 'blue' },
  pending_review: { label: '待确认', tone: 'amber' },
  completed: { label: '已完成', tone: 'green' }
};

export const STAGE_INFO = {
  1: { name: '文献调研', sub: '检索策略 · 核验 · 现状报告', step: 'Step 1' },
  2: { name: '研究论证', sub: '精读分析 · 对比矩阵 · 科学问题', step: 'Step 2' },
  3: { name: '申报写作', sub: '章节写作 · 引用 · 导出', step: 'Step 3' }
};

export function AppProvider({ children }) {
  const [projects, setProjects] = useState([]);
  const [settings, setSettings] = useState(null);
  const [meta, setMeta] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [currentId, setCurrentId] = useState(() => localStorage.getItem('rgs_current') || '');
  const [running, setRunning] = useState(null);
  const [ready, setReady] = useState(false);

  const refreshProjects = useCallback(async () => {
    try {
      const list = await api.projects.list();
      setProjects(list);
      return list;
    } catch (e) {
      toast(e.message, 'err');
      return [];
    }
  }, []);

  const refreshSettings = useCallback(async () => {
    try {
      const s = await api.settings.get();
      setSettings(s);
      return s;
    } catch (e) { return null; }
  }, []);

  const refreshMeta = useCallback(async () => {
    try { setMeta(await api.settings.meta()); } catch (e) {}
  }, []);

  useEffect(() => {
    (async () => {
      await Promise.all([refreshProjects(), refreshSettings(), refreshMeta()]);
      setReady(true);
    })();
  }, [refreshProjects, refreshSettings, refreshMeta]);

  const toast = useCallback((msg, type = 'info') => {
    const id = Date.now() + Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4600);
  }, []);

  const selectProject = (id) => {
    setCurrentId(id);
    if (id) localStorage.setItem('rgs_current', id);
  };

  const current = projects.find((p) => p.id === currentId) || null;

  return (
    <Ctx.Provider value={{ projects, settings, meta, toasts, ready, current, currentId, running, setRunning, refreshProjects, refreshSettings, refreshMeta, selectProject, toast }}>
      {children}
    </Ctx.Provider>
  );
}

export function Toasts() {
  const { toasts } = useApp();
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.type === 'err' ? 'err' : t.type === 'ok' ? 'ok' : ''}`}>{t.msg}</div>
      ))}
    </div>
  );
}
