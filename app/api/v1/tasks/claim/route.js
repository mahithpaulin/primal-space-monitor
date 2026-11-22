import { withStateRead, withState } from '../../../../../lib/store.js';
import { authenticateDevice } from '../../../../../lib/auth.js';
import { taskView } from '../../../../../lib/tasks.js';
import { cleanString, json, fail, readJson } from '../../../../../lib/http.js';
import { normalizeWorkloads } from '../../../../../lib/workloads.js';
import { sweepStore } from '../../../../../lib/scheduler.js';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const body = await readJson(request);
  if (!body) return fail('invalid_json', 400);
  const deviceId = cleanString(body.device_id, 64);
  if (!deviceId) return fail('device_id_required', 400);

  await sweepStore();
  const state = await withStateRead((current) => current);
  const auth = authenticateDevice(state, request, deviceId);
  if (auth.error) return fail(auth.error, auth.status);

  if (body.compute_enabled !== true) {
    return json({ ok: true, task: null, reason: 'compute_disabled' });
  }

  const now = Date.now();
  const requested = normalizeWorkloads(body.workloads);
  const stored = normalizeWorkloads(state.devices[deviceId]?.workloads);
  const supported = stored.length ? stored : requested.length ? requested : null;
  const existing = Object.values(state.tasks).find(
    (task) => task.claimed_by === deviceId && ['claimed', 'executing'].includes(task.status)
  );
  if (existing) {
    if (Date.parse(existing.deadline_at) < now) {
      await withState((current) => {
        const task = current.tasks[existing.id];
        if (!task) return null;
        task.status = 'failed';
        task.error = 'deadline_exceeded';
        task.completed_at = new Date(now).toISOString();
        return null;
      });
      return json({ ok: true, task: null, server_time: new Date(now).toISOString() });
    }
    return json({
      ok: true,
      task: taskView(existing, state.devices),
      server_time: new Date(now).toISOString(),
    });
  }

  const pending = Object.values(state.tasks)
    .filter((task) => (task.device_id === deviceId || task.device_id === null) && task.status === 'pending')
    .filter((task) => !supported || supported.includes(task.workload))
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))[0];

  if (!pending) {
    return json({ ok: true, task: null, server_time: new Date(now).toISOString() });
  }

  if (Date.parse(pending.deadline_at) < now) {
    await withState((current) => {
      const task = current.tasks[pending.id];
      if (!task) return null;
      task.status = 'failed';
      task.error = 'deadline_exceeded';
      task.completed_at = new Date(now).toISOString();
      return null;
    });
    return json({ ok: true, task: null, server_time: new Date(now).toISOString() });
  }

  const claimed = await withState((current) => {
    const task = current.tasks[pending.id];
    if (!task || task.status !== 'pending') return null;
    task.status = 'claimed';
    task.claimed_at = new Date(now).toISOString();
    task.claimed_by = deviceId;
    task.device_id = deviceId;
    return taskView(task, current.devices);
  });

  if (!claimed) {
    return json({ ok: true, task: null, server_time: new Date(now).toISOString() });
  }

  return json({ ok: true, task: claimed, server_time: new Date(now).toISOString() });
}
