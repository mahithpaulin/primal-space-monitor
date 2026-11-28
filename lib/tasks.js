import crypto from 'node:crypto';
import { WORKLOAD_IDS, isWorkload } from './workloads.js';

export const WORKLOADS = WORKLOAD_IDS;
export const TASK_STATUSES = ['pending', 'claimed', 'executing', 'completed', 'failed', 'cancelled'];
export const MAX_DEADLINE_SECONDS = 900;
export const MAX_PYTHON_CODE = 65536;
export const MAX_ARGS = 16384;
export const MAX_ITEMS = 512;
export const MAX_SHELL_COMMAND = 4000;
export const MAX_HTTP_BODY = 16384;
export const MAX_HTTP_HEADERS = 20;
export const MAX_STDOUT = 65536;
export const MAX_RESULT_BYTES = 16384;

export const DEFAULT_RESOURCE_LIMITS = {
  max_cpu_pct: 20,
  max_memory_mb: 128,
  deadline_seconds: 120,
  max_seconds: 10,
};

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

export function normalizeLimits(input = {}) {
  return {
    max_cpu_pct: Math.round(clampNumber(input.max_cpu_pct, 20, 1, 50)),
    max_memory_mb: Math.round(clampNumber(input.max_memory_mb, 128, 16, 512)),
    deadline_seconds: Math.round(
      clampNumber(input.deadline_seconds, 120, 5, MAX_DEADLINE_SECONDS)
    ),
    max_seconds: Math.round(clampNumber(input.max_seconds, 10, 1, 30)),
  };
}

function jsonSize(value) {
  const encoded = JSON.stringify(value);
  return encoded === undefined ? 0 : Buffer.byteLength(encoded, 'utf8');
}

export function normalizeItems(input) {
  if (input === undefined || input === null) return null;
  if (!Array.isArray(input)) throw new Error('items_must_be_array');
  if (input.length > MAX_ITEMS) throw new Error('items_too_large');
  if (jsonSize(input) > MAX_ARGS) throw new Error('items_too_large');
  return input;
}

export function normalizeWorkloadParams(workload, input = {}) {
  if (!isWorkload(workload)) throw new Error('unsupported_workload');
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('params_must_be_object');
  }
  if (workload === 'python') {
    const code = typeof input.code === 'string' ? input.code : '';
    if (!code.trim()) throw new Error('python_code_required');
    if (Buffer.byteLength(code, 'utf8') > MAX_PYTHON_CODE) throw new Error('python_code_too_large');
    const items = normalizeItems(input.items);
    const args = input.args !== undefined ? input.args : items;
    if (jsonSize(args) > MAX_ARGS) throw new Error('python_args_too_large');
    return { code, args, items };
  }
  if (workload === 'shell') {
    const command = typeof input.command === 'string' ? input.command.trim() : '';
    if (!command) throw new Error('shell_command_required');
    if (Buffer.byteLength(command, 'utf8') > MAX_SHELL_COMMAND) throw new Error('shell_command_too_large');
    return { command, items: normalizeItems(input.items) };
  }
  const method = String(input.method || 'GET').toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(method)) {
    throw new Error('http_method_invalid');
  }
  const url = typeof input.url === 'string' ? input.url.trim() : '';
  if (!/^https?:\/\/[^\s]+$/i.test(url)) throw new Error('http_url_invalid');
  if (url.length > 2000) throw new Error('http_url_too_large');
  const headers = {};
  if (input.headers && typeof input.headers === 'object' && !Array.isArray(input.headers)) {
    const entries = Object.entries(input.headers).slice(0, MAX_HTTP_HEADERS);
    for (const [key, value] of entries) {
      if (typeof key !== 'string' || typeof value !== 'string') continue;
      if (!/^[a-zA-Z0-9-]{1,64}$/.test(key)) continue;
      headers[key] = value.slice(0, 1000);
    }
  }
  const body = typeof input.body === 'string' ? input.body.slice(0, MAX_HTTP_BODY) : null;
  const timeoutSeconds = Math.round(clampNumber(input.timeout_s, 20, 1, 30));
  return { method, url, headers, body, timeout_s: timeoutSeconds };
}

export function createTask({ deviceId, workload, params, resourceLimits, createdBy = 'api', jobId = null, shardIndex = null }) {
  const id = crypto.randomUUID();
  const now = Date.now();
  const limits = normalizeLimits(resourceLimits);
  const normalizedParams = normalizeWorkloadParams(workload, params);
  if (params && typeof params === 'object') {
    const shard = Number(params.shard_index);
    const shards = Number(params.shard_count);
    if (Number.isFinite(shard)) normalizedParams.shard_index = shard;
    if (Number.isFinite(shards)) normalizedParams.shard_count = shards;
  }
  return {
    id,
    device_id: deviceId || null,
    target_device_id: deviceId || null,
    workload,
    job_id: jobId,
    shard_index: shardIndex,
    attempts: 0,
    params: normalizedParams,
    resource_limits: limits,
    status: 'pending',
    created_by: createdBy,
    created_at: new Date(now).toISOString(),
    deadline_at: new Date(now + limits.deadline_seconds * 1000).toISOString(),
    claimed_at: null,
    completed_at: null,
    claimed_by: null,
    cancel_requested: false,
    result_value: null,
    stdout: null,
    duration_ms: null,
    verified: null,
    error: null,
    metrics: null,
  };
}

export function taskView(task, devices = {}) {
  return {
    id: task.id,
    device_id: task.device_id,
    device_name: devices[task.device_id]?.name ?? null,
    target_device_id: task.target_device_id ?? null,
    preferred_device_id: task.preferred_device_id ?? null,
    preferred_device_name: devices[task.preferred_device_id]?.name ?? null,
    workload: task.workload,
    job_id: task.job_id ?? null,
    shard_index: task.shard_index ?? null,
    attempts: task.attempts ?? 0,
    params: task.params,
    resource_limits: task.resource_limits,
    status: task.status,
    created_by: task.created_by,
    created_at: task.created_at,
    deadline_at: task.deadline_at,
    claimed_at: task.claimed_at,
    started_at: task.started_at ?? null,
    completed_at: task.completed_at,
    cancel_requested: task.cancel_requested === true,
    result_value: task.result_value,
    stdout: task.stdout ?? null,
    duration_ms: task.duration_ms,
    verified: task.verified,
    error: task.error,
    metrics: task.metrics,
  };
}
