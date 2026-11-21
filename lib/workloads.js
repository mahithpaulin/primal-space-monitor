export function normalizeWorkloads(value) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
  const seen = new Set();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const name = item.trim();
    if (!name || name.length > 64) continue;
    seen.add(name);
    if (seen.size >= 16) break;
  }
  return [...seen];
}
