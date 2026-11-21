import { withState } from '../../../../../lib/store.js';
import { authenticateDevice } from '../../../../../lib/auth.js';
import { taskView } from '../../../../../lib/tasks.js';
import { cleanString, json, fail, readJson } from '../../../../../lib/http.js';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const body = await readJson(request);
  if (!body) return fail('invalid_json', 400);
  const deviceId = cleanString(body.device_id, 64);
  if (!deviceId) return fail('device_id_required', 400);

  const result = await withState((state) => {
    const auth = authenticateDevice(state, request, deviceId);
    if (auth.error) return auth;

    if (body.compute_enabled !== true) {
      return { ok: true, task: null, reason: 'compute_disabled' };
    }

    const now = Date.now();
    const existing = Object.values(state.tasks).find(
      (task) =>
        task.claimed_by === deviceId && ['claimed', 'executing'].includes(task.status)
    );
    if (existing) {
      if (Date.parse(existing.deadline_at) < now) {
        existing.status = 'failed';
        existing.error = 'deadline_exceeded';
        existing.completed_at = new Date(now).toISOString();
      } else {
        return { ok: true, task: taskView(existing, state.devices), server_time: new Date(now).toISOString() };
      }
    }

    const pending = Object.values(state.tasks)
      .filter((task) => (task.device_id === deviceId || task.device_id === null) && task.status === 'pending')
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))[0];

    if (!pending) return { ok: true, task: null, server_time: new Date(now).toISOString() };

    if (Date.parse(pending.deadline_at) < now) {
      pending.status = 'failed';
      pending.error = 'deadline_exceeded';
      pending.completed_at = new Date(now).toISOString();
      return { ok: true, task: null, server_time: new Date(now).toISOString() };
    }

    pending.status = 'claimed';
    pending.claimed_at = new Date(now).toISOString();
    pending.claimed_by = deviceId;
    pending.device_id = deviceId;
    return { ok: true, task: taskView(pending, state.devices), server_time: new Date(now).toISOString() };
  });

  if (!result.ok) return fail(result.error, result.status);
  return json(result);
}
