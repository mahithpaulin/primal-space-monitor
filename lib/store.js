import { get, put } from '@vercel/blob';

const STATE_PATH = process.env.PRIMAL_STATE_PATH || 'primal-space/state.json';
const ACCESS = 'private';

export function emptyState() {
  return { version: 1, devices: {}, tasks: {} };
}

function isNotFound(error) {
  const text = `${error?.name || ''} ${error?.message || ''}`;
  return /not.?found|404/i.test(text);
}

export async function readState() {
  try {
    const result = await get(STATE_PATH, { access: ACCESS, useCache: false });
    if (!result || result.statusCode !== 200 || !result.stream) return emptyState();
    const text = await new Response(result.stream).text();
    const state = JSON.parse(text);
    if (!state || typeof state !== 'object') return emptyState();
    state.devices = state.devices && typeof state.devices === 'object' ? state.devices : {};
    state.tasks = state.tasks && typeof state.tasks === 'object' ? state.tasks : {};
    return state;
  } catch (error) {
    if (isNotFound(error)) return emptyState();
    throw error;
  }
}

export async function writeState(state) {
  await put(STATE_PATH, JSON.stringify(state), {
    access: ACCESS,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 0,
  });
}

let queue = Promise.resolve();

export function withState(mutator) {
  const run = queue.then(async () => {
    const state = await readState();
    const result = await mutator(state);
    await writeState(state);
    return result;
  });
  queue = run.catch(() => {});
  return run;
}

export function pruneTasks(state, keep = 100) {
  const tasks = Object.values(state.tasks);
  if (tasks.length <= keep) return;
  const active = tasks.filter((t) => ['pending', 'claimed', 'executing'].includes(t.status));
  const done = tasks
    .filter((t) => !['pending', 'claimed', 'executing'].includes(t.status))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, Math.max(0, keep - active.length));
  const kept = new Set([...active, ...done].map((t) => t.id));
  for (const id of Object.keys(state.tasks)) {
    if (!kept.has(id)) delete state.tasks[id];
  }
}
