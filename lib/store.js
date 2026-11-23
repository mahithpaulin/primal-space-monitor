import { get, put } from '@vercel/blob';

const STATE_PATH = process.env.PRIMAL_STATE_PATH || 'primal-space/state.json';
const ACCESS = 'private';

export function emptyState() {
  return { version: 1, devices: {}, tasks: {}, jobs: {}, messages: {}, credit_events: {} };
}

function isNotFound(error) {
  const text = `${error?.name || ''} ${error?.message || ''}`;
  return /not.?found|404/i.test(text);
}

function databaseUrl() {
  const value = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || process.env.POSTGRES_URL_NON_POOLING;
  return typeof value === 'string' && value.startsWith('postgres') ? value : null;
}

let pgClient = null;

async function getPool() {
  if (pgClient) return pgClient;
  const url = databaseUrl();
  if (!url) return null;
  const { Pool } = await import('pg');
  pgClient = new Pool({
    connectionString: url,
    max: 3,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
    ssl: { rejectUnauthorized: false },
  });
  return pgClient;
}

function normalizeState(data) {
  if (!data || typeof data !== 'object') return emptyState();
  data.devices = data.devices && typeof data.devices === 'object' ? data.devices : {};
  data.tasks = data.tasks && typeof data.tasks === 'object' ? data.tasks : {};
  data.jobs = data.jobs && typeof data.jobs === 'object' ? data.jobs : {};
  data.messages = data.messages && typeof data.messages === 'object' ? data.messages : {};
  data.credit_events = data.credit_events && typeof data.credit_events === 'object' ? data.credit_events : {};
  return data;
}

const STATE_QUERY = 'select data from primal_space_state where id = $1';
const STATE_WRITE = `insert into primal_space_state (id, data, updated_at)
     values ('primal-space', $1::jsonb, now())
     on conflict (id) do update set data = excluded.data, updated_at = now()`;

async function readStatePostgres() {
  const pool = await getPool();
  if (!pool) return null;
  const result = await pool.query(STATE_QUERY, ['primal-space']);
  if (!result.rows.length) return emptyState();
  return normalizeState(result.rows[0].data);
}

async function writeStatePostgres(state) {
  const pool = await getPool();
  if (!pool) return false;
  await pool.query(STATE_WRITE, [JSON.stringify(state)]);
  return true;
}

async function readStateBlob() {
  try {
    const result = await get(STATE_PATH, { access: ACCESS, useCache: false });
    if (!result || result.statusCode !== 200 || !result.stream) return emptyState();
    const text = await new Response(result.stream).text();
    const state = JSON.parse(text);
    if (!state || typeof state !== 'object') return emptyState();
    state.devices = state.devices && typeof state.devices === 'object' ? state.devices : {};
    state.tasks = state.tasks && typeof state.tasks === 'object' ? state.tasks : {};
    state.jobs = state.jobs && typeof state.jobs === 'object' ? state.jobs : {};
    state.messages = state.messages && typeof state.messages === 'object' ? state.messages : {};
    state.credit_events = state.credit_events && typeof state.credit_events === 'object' ? state.credit_events : {};
    return state;
  } catch (error) {
    if (isNotFound(error)) return emptyState();
    throw error;
  }
}

async function writeStateBlob(state) {
  await put(STATE_PATH, JSON.stringify(state), {
    access: ACCESS,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 0,
  });
}

export async function readState() {
  if (databaseUrl()) {
    try {
      return await readStatePostgres();
    } catch (error) {
      console.error('postgres state read failed; falling back to blob', error?.message || error);
    }
  }
  return readStateBlob();
}

export async function writeState(state) {
  if (databaseUrl()) {
    try {
      const written = await writeStatePostgres(state);
      if (written) return;
    } catch (error) {
      console.error('postgres state write failed; falling back to blob', error?.message || error);
    }
  }
  await writeStateBlob(state);
}

let queue = Promise.resolve();

async function mutatePostgres(mutator) {
  const pool = await getPool();
  if (!pool) return null;
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query("select pg_advisory_xact_lock(hashtext('primal_space_state'))");
    const found = await client.query(STATE_QUERY, ['primal-space']);
    const state = found.rows.length ? normalizeState(found.rows[0].data) : emptyState();
    const result = await mutator(state);
    await client.query(STATE_WRITE, [JSON.stringify(state)]);
    await client.query('commit');
    return { result };
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export function withState(mutator) {
  const run = queue.then(async () => {
    if (databaseUrl()) {
      try {
        const outcome = await mutatePostgres(mutator);
        if (outcome) return outcome.result;
      } catch (error) {
        console.error('postgres state transaction failed; falling back to blob', error?.message || error);
      }
    }
    const state = await readState();
    const result = await mutator(state);
    await writeState(state);
    return result;
  });
  queue = run.catch(() => {});
  return run;
}

export async function withStateRead(mutator) {
  const state = await readState();
  return mutator(state);
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

export function pruneJobs(state, keep = 30) {
  if (!state.jobs || typeof state.jobs !== 'object') return;
  const jobs = Object.values(state.jobs);
  if (jobs.length <= keep) return;
  const active = jobs.filter((job) => !['completed', 'failed', 'cancelled'].includes(job.status));
  const done = jobs
    .filter((job) => ['completed', 'failed', 'cancelled'].includes(job.status))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, Math.max(0, keep - active.length));
  const kept = new Set([...active, ...done].map((job) => job.id));
  for (const id of Object.keys(state.jobs)) {
    if (!kept.has(id)) delete state.jobs[id];
  }
}

export function pruneMessages(state, keep = 200) {
  if (!state.messages || typeof state.messages !== 'object') {
    state.messages = {};
    return;
  }
  const messages = Object.values(state.messages);
  if (messages.length <= keep) return;
  const kept = messages
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, keep)
    .map((message) => message.id);
  const allowed = new Set(kept);
  for (const id of Object.keys(state.messages)) {
    if (!allowed.has(id)) delete state.messages[id];
  }
}

export function pruneCreditEvents(state, keep = 500) {
  if (!state.credit_events || typeof state.credit_events !== 'object') {
    state.credit_events = {};
    return;
  }
  const events = Object.values(state.credit_events);
  if (events.length <= keep) return;
  const kept = events
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, keep)
    .map((event) => event.id);
  const allowed = new Set(kept);
  for (const id of Object.keys(state.credit_events)) {
    if (!allowed.has(id)) delete state.credit_events[id];
  }
}
