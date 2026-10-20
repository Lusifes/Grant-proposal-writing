export function navigate(path) {
  location.hash = '#' + path;
}

export function parseRoute() {
  const h = (location.hash || '').replace(/^#/, '') || '/';
  const parts = h.split('/').filter(Boolean);
  if (parts[0] === 'p') {
    let stage = null;
    const raw = parts[2] === 'stage' ? parts[3] : parts[2];
    if (raw) {
      const n = Number(raw);
      if (!Number.isNaN(n)) stage = n;
    }
    return { page: 'project', id: parts[1], stage };
  }
  if (parts[0] === 'settings') return { page: 'settings' };
  return { page: 'home' };
}
