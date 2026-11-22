import crypto from 'node:crypto';
import { MOD, MAX_ITERATIONS, normalizePythonParams } from './tasks.js';

export const MAX_SHARDS = 64;
export const MAX_JOB_ITERATIONS = 2000000;
export const MAX_JOB_DEADLINE_SECONDS = 900;
const SEED_PATTERN = /^[a-zA-Z0-9:_-]{1,64}$/;

export function normalizeShardCount(value, total = 1) {
  const raw = Math.round(Number(value));
  const requested = Number.isFinite(raw) ? Math.min(MAX_SHARDS, Math.max(1, raw)) : 1;
  const needed = Math.ceil(Math.max(1, total) / MAX_ITERATIONS);
  return Math.min(MAX_SHARDS, Math.max(requested, needed));
}

export function planJob({ workload, params = {}, shards = 8 }) {
  if (workload === 'python_func') {
    return {
      shard_count: 1,
      total_iterations: null,
      shards: [{ index: 0, params: normalizePythonParams(params) }],
    };
  }
  const seed =
    typeof params.seed === 'string' && SEED_PATTERN.test(params.seed)
      ? params.seed.slice(0, 52)
      : crypto.randomBytes(8).toString('hex');
  const requested = Math.round(Number(params.iterations) || 200000);
  const total = Math.min(MAX_JOB_ITERATIONS, Math.max(1, requested));
  const count = normalizeShardCount(shards, total);
  const perShard = Math.ceil(total / count);
  const chunks = Math.min(64, Math.max(1, Math.round(Number(params.chunks) || 8)));
  const list = [];
  for (let index = 0; index < count; index += 1) {
    list.push({
      index,
      params: { seed: `${seed}-s${index}`, iterations: perShard, chunks: Math.min(chunks, perShard) },
    });
  }
  return { shard_count: count, total_iterations: total, shards: list };
}

export function jobDeadlineSeconds(shardCount) {
  return Math.min(MAX_JOB_DEADLINE_SECONDS, Math.max(120, shardCount * 25));
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

export function aggregateJob(job, tasks) {
  const list = job.task_ids.map((id) => tasks[id]).filter(Boolean);
  if (!list.length) return null;
  if (job.workload === 'python_func') {
    const task = list[0];
    return {
      value: task.status === 'completed' ? task.result_value ?? null : null,
      partial_value: null,
      verified: null,
      completed_shards: task.status === 'completed' ? 1 : 0,
      failed_shards: task.status === 'failed' || task.status === 'cancelled' ? 1 : 0,
    };
  }
  const completed = list.filter((task) => task.status === 'completed' && task.verified === true);
  const failed = list.filter((task) => task.status === 'failed' || task.status === 'cancelled');
  let total = 0n;
  for (const task of completed) {
    total = (total + BigInt(Math.round(task.result_value || 0))) % BigInt(MOD);
  }
  const settled = completed.length + failed.length === list.length;
  return {
    value: settled && failed.length === 0 ? Number(total) : null,
    partial_value: completed.length ? Number(total) : null,
    verified: settled ? failed.length === 0 : null,
    completed_shards: completed.length,
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

export function jobView(job, tasks, devices = {}) {
  return {
    id: job.id,
    workload: job.workload,
    status: jobStatus(job, tasks),
    shard_count: job.shard_count,
    total_iterations: job.total_iterations ?? null,
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
