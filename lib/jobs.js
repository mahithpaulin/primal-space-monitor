import crypto from 'node:crypto';
import { MAX_RESULT_BYTES, normalizeWorkloadParams } from './tasks.js';
import { isWorkload } from './workloads.js';

export const MAX_SHARDS = 64;
export const MAX_JOB_DEADLINE_SECONDS = 900;
export const REDUCES = ['concat', 'sum', 'count', 'first'];

const SHARDABLE = new Set(['python', 'shell']);

export function normalizeReduce(value) {
  if (REDUCES.includes(value)) return value;
  const match = /^sum:([A-Za-z0-9_.-]{1,48})$/.exec(String(value || ''));
  if (match) return `sum:${match[1]}`;
  return 'concat';
}

export function planJob({ workload, params = {}, shards = 1, reduce = 'concat' }) {
  if (!isWorkload(workload)) throw new Error('unsupported_workload');
  const normalized = normalizeWorkloadParams(workload, params);
  const requested = Math.round(Number(shards) || 1);
  const items = Array.isArray(normalized.items) ? normalized.items : null;
  const reduction = normalizeReduce(reduce);

  if (SHARDABLE.has(workload) && items && items.length > 0) {
    const count = Math.min(MAX_SHARDS, items.length, Math.max(1, requested));
    const size = Math.ceil(items.length / count);
    const list = [];
    for (let index = 0; index < count; index += 1) {
      const slice = items.slice(index * size, (index + 1) * size);
      if (!slice.length) continue;
      const shardParams = { ...normalized, items: slice };
      if (workload === 'python') shardParams.args = slice;
      list.push({ index: list.length, params: shardParams });
    }
    for (const shard of list) {
      shard.params.shard_index = shard.index;
      shard.params.shard_count = list.length;
    }
    return { shard_count: list.length, item_count: items.length, shards: list, reduce: reduction };
  }

  if (SHARDABLE.has(workload) && requested > 1) {
    throw new Error('items_required_for_sharding');
  }

  return {
    shard_count: 1,
    item_count: items?.length ?? null,
    shards: [{ index: 0, params: { ...normalized, shard_index: 0, shard_count: 1 } }],
    reduce: reduction,
  };
}

export function jobDeadlineSeconds(shardCount) {
  return Math.min(MAX_JOB_DEADLINE_SECONDS, Math.max(240, shardCount * 60));
}

export function jobProgress(job, tasks) {
  const progress = { total: 0, pending: 0, claimed: 0, executing: 0, completed: 0, failed: 0, cancelled: 0 };
  for (const id of job.task_ids) {
    const task = tasks[id];
    if (!task) continue;
    progress.total += 1;
    if (progress[task.status] !== undefined) progress[task.status] += 1;
  }
  return progress;
}

export function jobStatus(job, tasks) {
  const progress = jobProgress(job, tasks);
  if (job.cancelled_at) {
    const active = progress.pending + progress.claimed + progress.executing;
    return active > 0 ? 'cancelling' : 'cancelled';
  }
  if (progress.total === 0) return 'failed';
  if (progress.pending || progress.claimed || progress.executing) {
    return progress.completed || progress.failed || progress.cancelled ? 'running' : 'pending';
  }
  return progress.completed === progress.total ? 'completed' : 'failed';
}

function concatValues(values) {
  const flat = [];
  for (const value of values) {
    if (Array.isArray(value)) flat.push(...value);
    else if (value !== null && value !== undefined) flat.push(value);
  }
  return flat;
}

function sumValues(values, field = null) {
  let total = 0;
  for (const value of values) {
    const source = field && value && typeof value === 'object' && !Array.isArray(value)
      ? value[field]
      : value;
    if (source === undefined || source === null) return null;
    const numbers = Array.isArray(source) ? source : [source];
    for (const number of numbers) {
      const parsed = Number(number);
      if (!Number.isFinite(parsed)) return null;
      total += parsed;
    }
  }
  return Number(total.toFixed(6));
}

export function aggregateJob(job, tasks) {
  const list = job.task_ids.map((id) => tasks[id]).filter(Boolean);
  if (!list.length) return null;
  const done = list.filter((task) => task.status === 'completed');
  const failed = list.filter((task) => task.status === 'failed' || task.status === 'cancelled');
  const settled = done.length + failed.length === list.length;
  const values = done.map((task) => task.result_value ?? null);

  let value = null;
  if (job.reduce === 'sum') value = done.length ? sumValues(values) : null;
  else if (job.reduce?.startsWith('sum:')) value = done.length ? sumValues(values, job.reduce.slice(4)) : null;
  else if (job.reduce === 'count') {
    value = values.reduce(
      (total, item) => total + (Array.isArray(item) ? item.length : item === null ? 0 : 1),
      0
    );
  } else if (job.reduce === 'first') value = values.length ? values[0] : null;
  else value = done.length ? concatValues(values) : null;

  let encoded = null;
  try {
    encoded = JSON.stringify(value);
  } catch {
    value = null;
  }
  if (encoded && Buffer.byteLength(encoded, 'utf8') > MAX_RESULT_BYTES * 4) {
    value = { truncated: true, preview: encoded.slice(0, MAX_RESULT_BYTES * 4) };
  }

  const complete = settled && failed.length === 0;
  return {
    value: complete ? value : null,
    partial_value: done.length ? value : null,
    verified: settled ? failed.length === 0 : null,
    completed_shards: done.length,
    failed_shards: failed.length,
  };
}

export function finalizeJob(job, tasks, now = Date.now()) {
  const status = jobStatus(job, tasks);
  const aggregate = aggregateJob(job, tasks);
  const changed =
    job.status !== status ||
    JSON.stringify(job.aggregate ?? null) !== JSON.stringify(aggregate ?? null);
  job.status = status;
  job.aggregate = aggregate;
  if (['completed', 'failed', 'cancelled'].includes(status) && !job.completed_at) {
    job.completed_at = new Date(now).toISOString();
  }
  return changed;
}

function jobSummary(job) {
  const params = job.params || {};
  if (job.workload === 'python') {
    return { items: job.item_count ?? null, code_bytes: Buffer.byteLength(params.code || '', 'utf8') };
  }
  if (job.workload === 'shell') {
    return { items: job.item_count ?? null, command: String(params.command || '').slice(0, 300) };
  }
  return { method: params.method, url: params.url, items: job.item_count ?? null };
}

export function jobView(job, tasks, devices = {}) {
  return {
    id: job.id,
    workload: job.workload,
    status: jobStatus(job, tasks),
    shard_count: job.shard_count,
    item_count: job.item_count ?? null,
    reduce: job.reduce || 'concat',
    summary: jobSummary(job),
    progress: jobProgress(job, tasks),
    aggregate: aggregateJob(job, tasks),
    created_by: job.created_by,
    created_at: job.created_at,
    deadline_at: job.deadline_at,
    completed_at: job.completed_at ?? null,
    cancelled_at: job.cancelled_at ?? null,
    shards: job.task_ids
      .map((id) => tasks[id])
      .filter(Boolean)
      .map((task) => ({
        id: task.id,
        index: task.shard_index ?? 0,
        status: task.status,
        device_id: task.claimed_by ?? null,
        device_name: devices[task.claimed_by]?.name ?? null,
        value: task.result_value ?? null,
        verified: task.verified ?? null,
        error: task.error ?? null,
        attempts: task.attempts ?? 0,
        duration_ms: task.duration_ms ?? null,
      })),
  };
}
