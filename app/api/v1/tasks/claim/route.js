import { withState, withStateRead } from '../../../../../lib/store.js';
import { authenticateDevice } from '../../../../../lib/auth.js';
import { taskView } from '../../../../../lib/tasks.js';
import { cleanString, json, fail, readJson } from '../../../../../lib/http.js';
import { normalizeWorkloads } from '../../../../../lib/workloads.js';
import { sweepStore } from '../../../../../lib/scheduler.js';

export const dynamic = 'force-dynamic';

function computeBlocked(device, now = Date.now()) {
  if (device.worker?.compute_enabled !== true || device.worker?.paused === true) {
    return 'compute_disabled';
  }
  const lending = device.lending || {};
  if (lending.enabled !== true) return null;
  const allowance = Math.max(0, Number(lending.minutes_per_hour) || 0);
  if (!allowance) return null;
  const windowStart = new Date(Math.floor(now / 3600000) * 3600000).toISOString();
  const credits = device.credits || {};
  if (credits.window_start !== windowStart) return null;
  return Number(credits.minutes_used || 0) >= allowance ? 'lending_allowance_reached' : null;
}

export async function POST(request) {
  const body = await readJson(request);
  if (!body) return fail('invalid_json', 400);
  const deviceId = cleanString(body.device_id, 64);
  if (!deviceId) return fail('device_id_required', 400);

  await sweepStore();
  const candidate = await withStateRead((state) => {
    const auth = authenticateDevice(state, request, deviceId);
    if (auth.error) return auth;

    const blocked = computeBlocked(auth.device);
    if (body.compute_enabled !== true || blocked) {
      return { ok: true, task: null, reason: blocked || 'compute_disabled' };
    }

    const now = Date.now();
    const requested = normalizeWorkloads(body.workloads);
    const stored = state.devices[deviceId]?.workloads;
    const supported = Array.isArray(stored) ? normalizeWorkloads(stored) : requested;
    const existing = Object.values(state.tasks).find(
      (task) => task.claimed_by === deviceId && ['claimed', 'executing'].includes(task.status),
    );
    if (existing) {
      return {
        ok: true,
        task: taskView(existing, state.devices),
        server_time: new Date(now).toISOString(),
      };
    }

    const pending = Object.values(state.tasks)
      .filter((task) => task.status === 'pending')
      .filter((task) => task.device_id === null || task.device_id === deviceId)
      .filter((task) => supported.includes(task.workload))
      .filter((task) => Date.parse(task.deadline_at) >= now)
      .sort((a, b) => {
        const preferred = Number(b.preferred_device_id === deviceId) - Number(a.preferred_device_id === deviceId);
        if (preferred) return preferred;
        const created = Date.parse(a.created_at) - Date.parse(b.created_at);
        return created || a.id.localeCompare(b.id);
      })[0];

    if (!pending) {
      return { ok: true, task: null, server_time: new Date(now).toISOString() };
    }
    return { ok: true, pendingId: pending.id, server_time: new Date(now).toISOString() };
  });

  if (candidate.error) return fail(candidate.error, candidate.status);
  if (!candidate.pendingId) return json(candidate);

  const claimed = await withState((state) => {
    const auth = authenticateDevice(state, request, deviceId);
    if (auth.error) return auth;
    if (computeBlocked(auth.device)) return null;
    const task = state.tasks[candidate.pendingId];
    if (!task || task.status !== 'pending') return null;
    const requested = normalizeWorkloads(body.workloads);
    const stored = state.devices[deviceId]?.workloads;
    const supported = Array.isArray(stored) ? normalizeWorkloads(stored) : requested;
    if (!supported.includes(task.workload)) return null;
    if (task.device_id !== null && task.device_id !== deviceId) return null;
    if (Date.parse(task.deadline_at) < Date.now()) return null;
    task.status = 'claimed';
    task.claimed_at = new Date().toISOString();
    task.claimed_by = deviceId;
    task.device_id = deviceId;
    return taskView(task, state.devices);
  });

  if (claimed?.error) return fail(claimed.error, claimed.status);
  return json({
    ok: true,
    task: claimed || null,
    server_time: candidate.server_time,
  });
}
