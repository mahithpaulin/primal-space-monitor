import { withState, pruneTasks } from '../../../../../lib/store.js';
import { authenticateDevice } from '../../../../../lib/auth.js';
import { MAX_RESULT_BYTES, MAX_STDOUT, taskView } from '../../../../../lib/tasks.js';
import { finalizeJob } from '../../../../../lib/jobs.js';
import { cleanString, finiteNumber, json, fail, readJson } from '../../../../../lib/http.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function boundedResult(value) {
  if (value === undefined) return null;
  try {
    const encoded = JSON.stringify(value);
    if (encoded && Buffer.byteLength(encoded, 'utf8') > MAX_RESULT_BYTES) {
      return { truncated: true, preview: encoded.slice(0, MAX_RESULT_BYTES) };
    }
  } catch {
    return null;
  }
  return value;
}

export async function POST(request) {
  const body = await readJson(request);
  if (!body) return fail('invalid_json', 400);
  const deviceId = cleanString(body.device_id, 64);
  const taskId = cleanString(body.task_id, 64);
  if (!deviceId) return fail('device_id_required', 400);
  if (!taskId) return fail('task_id_required', 400);

  const result = await withState((state) => {
    const auth = authenticateDevice(state, request, deviceId);
    if (auth.error) return auth;

    const task = state.tasks[taskId];
    if (!task) return { error: 'task_not_found', status: 404 };
    if (task.device_id !== deviceId) return { error: 'task_not_owned_by_device', status: 403 };

    if (['completed', 'failed', 'cancelled'].includes(task.status)) {
      return { ok: true, task: taskView(task, state.devices), already_final: true };
    }
    if (!['claimed', 'executing'].includes(task.status)) {
      return { error: 'task_not_claimed', status: 409 };
    }

    const settle = () => {
      if (task.job_id && state.jobs?.[task.job_id]) finalizeJob(state.jobs[task.job_id], state.tasks);
    };
    const reportedStatus = cleanString(body.status, 16) || 'completed';
    const now = new Date().toISOString();
    const duration = finiteNumber(body.duration_ms, 0, 86400000);

    task.duration_ms = duration === null ? null : Math.round(duration);
    task.metrics = {
      cpu_pct_avg: finiteNumber(body.metrics?.cpu_pct_avg, 0, 100),
      cpu_load_pct: finiteNumber(body.metrics?.cpu_load_pct, 0, 1000),
      worker_cpu_pct_avg: finiteNumber(body.metrics?.worker_cpu_pct_avg, 0, 1000),
      rss_mb_peak: finiteNumber(body.metrics?.rss_mb_peak, 0, 4096),
    };

    if (reportedStatus === 'cancelled') {
      task.status = 'cancelled';
      task.error = cleanString(body.error, 200) || 'cancelled_by_worker';
      task.cancel_requested = false;
      task.completed_at = now;
      settle();
      pruneTasks(state);
      return { ok: true, task: taskView(task, state.devices) };
    }

    if (reportedStatus === 'failed') {
      task.status = 'failed';
      task.error = cleanString(body.error, 200) || 'worker_reported_failure';
      task.verified = false;
      task.completed_at = now;
      settle();
      pruneTasks(state);
      return { ok: true, task: taskView(task, state.devices) };
    }

    if (reportedStatus !== 'completed') {
      return { error: 'invalid_status', status: 400 };
    }

    if (task.cancel_requested) {
      task.status = 'cancelled';
      task.error = 'cancelled_before_result_accepted';
      task.cancel_requested = false;
      task.completed_at = now;
      settle();
      pruneTasks(state);
      return { ok: true, task: taskView(task, state.devices), cancelled: true };
    }

    task.result_value = boundedResult(body.result?.value);
    task.stdout = typeof body.stdout === 'string' ? body.stdout.slice(0, MAX_STDOUT) : null;
    task.verified = true;
    task.status = 'completed';
    task.error = null;
    task.completed_at = now;
    settle();
    pruneTasks(state);

    return { ok: true, verified: true, task: taskView(task, state.devices) };
  });

  if (result.error) return fail(result.error, result.status);
  return json(result);
}
