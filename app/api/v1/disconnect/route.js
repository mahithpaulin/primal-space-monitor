import { withState } from '../../../../lib/store.js';
import { authenticateDevice } from '../../../../lib/auth.js';
import { cleanString, json, fail, readJson } from '../../../../lib/http.js';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const body = await readJson(request);
  if (!body) return fail('invalid_json', 400);
  const deviceId = cleanString(body.device_id, 64);
  if (!deviceId) return fail('device_id_required', 400);

  const result = await withState((state) => {
    const auth = authenticateDevice(state, request, deviceId);
    if (auth.error) return auth;

    const device = auth.device;
    const now = new Date().toISOString();
    device.disconnected_at = now;
    device.worker = {
      ...(device.worker || {}),
      status: 'stopped',
      current_task_id: null,
      updated_at: now,
    };

    for (const task of Object.values(state.tasks)) {
      if (task.device_id === deviceId && ['claimed', 'executing'].includes(task.status)) {
        task.status = 'cancelled';
        task.error = 'device_disconnected';
        task.cancel_requested = false;
        task.completed_at = now;
      }
    }

    return { ok: true, device_id: deviceId, disconnected_at: now };
  });

  if (!result.ok) return fail(result.error, result.status);
  return json(result);
}
