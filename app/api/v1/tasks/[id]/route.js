import { readState, withState } from '../../../../../lib/store.js';
import { authenticateDevice } from '../../../../../lib/auth.js';
import { taskView } from '../../../../../lib/tasks.js';
import { finalizeJob } from '../../../../../lib/jobs.js';
import { adminGateResponse, isAdminRequest } from '../../../../../lib/admin.js';
import { cleanString, json, fail } from '../../../../../lib/http.js';

export const dynamic = 'force-dynamic';

export async function GET(request, context) {
  const { id } = await context.params;
  const state = await readState();
  const task = state.tasks[id];
  if (!task) return fail('task_not_found', 404);
  if (!isAdminRequest(request)) {
    const deviceId = cleanString(new URL(request.url).searchParams.get('device_id'), 64);
    if (!deviceId) return fail('device_id_required', 400);
    const auth = authenticateDevice(state, request, deviceId);
    if (auth.error) return fail(auth.error, auth.status);
    if (task.claimed_by !== deviceId && task.device_id !== deviceId) {
      return fail('task_not_owned_by_device', 403);
    }
  }
  return json({ task: taskView(task, state.devices) });
}

export async function POST(request, context) {
  if (!isAdminRequest(request)) {
    const gate = adminGateResponse();
    return fail(gate.error, gate.status);
  }
  const { id } = await context.params;
  const result = await withState((state) => {
    const task = state.tasks[id];
    if (!task) return { error: 'task_not_found', status: 404 };
    if (['pending', 'claimed', 'executing'].includes(task.status)) {
      if (task.status === 'pending') {
        task.status = 'cancelled';
        task.completed_at = new Date().toISOString();
        task.error = 'cancelled_by_operator';
      } else {
        task.cancel_requested = true;
      }
    }
    if (task.job_id && state.jobs?.[task.job_id]) finalizeJob(state.jobs[task.job_id], state.tasks);
    return { ok: true, task: taskView(task, state.devices) };
  });
  if (result.error) return fail(result.error, result.status);
  return json(result);
}
