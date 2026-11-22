export const WORKLOADS = [
  {
    id: 'python',
    label: 'Python function',
    runtimes: ['cli'],
    shardable: true,
    hint: 'Sandboxed Python. Define main(args) and return JSON-serializable data.',
  },
  {
    id: 'shell',
    label: 'Shell command',
    runtimes: ['cli'],
    shardable: true,
    hint: 'Runs under sh -c on a CLI device. Operator-only.',
  },
  {
    id: 'http',
    label: 'HTTP request',
    runtimes: ['cli', 'android'],
    shardable: false,
    hint: 'Fetches a URL from the device (APIs, inference endpoints, webhooks).',
  },
];

export const WORKLOAD_IDS = WORKLOADS.map((workload) => workload.id);

export function workloadInfo(id) {
  return WORKLOADS.find((workload) => workload.id === id) || null;
}

export function isWorkload(id) {
  return WORKLOAD_IDS.includes(id);
}

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
