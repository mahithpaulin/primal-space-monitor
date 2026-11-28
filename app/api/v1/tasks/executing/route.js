import { withState } from '../../../../../lib/store.js';
import { authenticateDevice } from '../../../../../lib/auth.js';
import { taskView } from '../../../../../lib/tasks.js';
import { finalizeJob } from '../../../../../lib/jobs.js';
import { cleanString, json, fail, readJson } from '../../../../../lib/http.js';

export const dynamic = 'force-dynamic';

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
    if (task.claimed_by !== deviceId && task.device_id !== deviceId) {
      return { error: 'task_not_owned_by_device', status: 403 };
    }
    if (task.status === 'executing') {
      return { ok: true, task: taskView(task, state.devices), already_executing: true };
    }
    if (task.status !== 'claimed') {
      return { error: 'task_not_claimed', status: 409 };
    }
    if (Date.parse(task.deadline_at) < Date.now()) {
      task.status = 'failed';
      task.error = 'deadline_exceeded';
      task.completed_at = new Date().toISOString();
      if (task.job_id && state.jobs?.[task.job_id]) finalizeJob(state.jobs[task.job_id], state.tasks);
      return { ok: true, task: taskView(task, state.devices), expired: true };
    }
    if (task.cancel_requested) {
      task.status = 'cancelled';
      task.error = 'cancelled_before_execution';
      task.cancel_requested = false;
      task.completed_at = new Date().toISOString();
      if (task.job_id && state.jobs?.[task.job_id]) finalizeJob(state.jobs[task.job_id], state.tasks);
      return { ok: true, task: taskView(task, state.devices), cancelled: true };
    }
    task.status = 'executing';
    task.started_at = new Date().toISOString();
    return { ok: true, task: taskView(task, state.devices) };
  });

  if (result.error) return fail(result.error, result.status);
  return json(result);
}
