import { withState } from '../../../../lib/store.js';
import { authenticateDevice } from '../../../../lib/auth.js';
import { sanitizeMetrics, sanitizeWorker } from '../../../../lib/device.js';
import { cleanString, json, fail, readJson } from '../../../../lib/http.js';
import { deviceStatus, offlineSeconds } from '../../../../lib/status.js';

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
    const metrics = sanitizeMetrics(body.metrics || {});
    const worker = sanitizeWorker(body.worker || {});
    const cliVersion = cleanString(body.cli_version, 32);
    const workloads = Array.isArray(body.workloads)
      ? body.workloads.filter((item) => typeof item === 'string' && item.length > 0 && item.length <= 64).slice(0, 16)
      : [];

    device.metrics = metrics;
    device.worker = worker;
    device.last_heartbeat = now;
    device.disconnected_at = null;
    if (cliVersion) device.cli_version = cliVersion;
    if (workloads.length) device.workloads = workloads;

    return {
      ok: true,
      device_id: device.id,
      server_time: now,
      offline_after_seconds: offlineSeconds(),
      status: deviceStatus(device),
    };
  });

  if (!result.ok) return fail(result.error, result.status);
  return json(result);
}
