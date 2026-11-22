import crypto from 'node:crypto';

export const MOD = 1000000007;
export const WORKLOADS = ['hash_sum_v1', 'python_func'];
export const TASK_STATUSES = ['pending', 'claimed', 'executing', 'completed', 'failed', 'cancelled'];
export const MAX_ITERATIONS = 500000;
export const MAX_CHUNKS = 64;
export const MAX_DEADLINE_SECONDS = 900;
export const MAX_PYTHON_CODE = 65536;
export const MAX_PYTHON_ARGS = 8192;
export const MAX_STDOUT = 65536;

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

export function normalizeParams(input = {}) {
  const seed =
    typeof input.seed === 'string' && /^[a-zA-Z0-9:_-]{1,64}$/.test(input.seed)
      ? input.seed
      : 'primal-default';
  const iterations = Math.round(clampNumber(input.iterations, 200000, 1, MAX_ITERATIONS));
  const chunks = Math.round(clampNumber(input.chunks, 8, 1, MAX_CHUNKS));
  return { seed, iterations, chunks };
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

export function normalizePythonParams(input = {}) {
  const code = typeof input.code === 'string' ? input.code : '';
  if (!code.trim()) throw new Error('python_code_required');
  if (Buffer.byteLength(code, 'utf8') > MAX_PYTHON_CODE) throw new Error('python_code_too_large');
  const args = input.args ?? null;
  let serialized;
  try {
    serialized = JSON.stringify(args);
  } catch {
    throw new Error('python_args_invalid');
  }
  if (serialized === undefined || Buffer.byteLength(serialized, 'utf8') > MAX_PYTHON_ARGS) {
    throw new Error('python_args_too_large');
  }
  return { code, args };
}

export function createTask({ deviceId, workload, params, resourceLimits, createdBy = 'api', jobId = null, shardIndex = null }) {
  const id = crypto.randomUUID();
  const now = Date.now();
  const limits = normalizeLimits(resourceLimits);
  return {
    id,
    device_id: deviceId || null,
    workload,
    job_id: jobId,
    shard_index: shardIndex,
    attempts: 0,
    params: workload === 'python_func' ? normalizePythonParams(params) : normalizeParams(params),
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

export function hashSum(params) {
  const { seed, iterations, chunks } = normalizeParams(params);
  const chunkSize = Math.ceil(iterations / chunks);
  let total = 0n;
  const chunkValues = [];

  for (let chunk = 0; chunk < chunks; chunk += 1) {
    const start = chunk * chunkSize;
    const end = Math.min(iterations, start + chunkSize);
    let sum = 0n;
    for (let index = start; index < end; index += 1) {
      const digest = crypto.createHash('sha256').update(`${seed}:${index}`).digest();
      const term = digest.readBigUInt64BE(0) % BigInt(MOD);
      sum = (sum + term) % BigInt(MOD);
    }
    chunkValues.push(Number(sum));
    total = (total + sum) % BigInt(MOD);
  }

  return { value: Number(total), chunk_values: chunkValues, chunk_size: chunkSize };
}

export function taskView(task, devices = {}) {
  return {
    id: task.id,
    device_id: task.device_id,
    device_name: devices[task.device_id]?.name ?? null,
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
