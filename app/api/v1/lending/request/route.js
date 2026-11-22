import { requestLending } from '../../../../../lib/actions.js';
import { adminGateResponse, isAdminRequest } from '../../../../../lib/admin.js';
import { cleanString, json, fail, readJson } from '../../../../../lib/http.js';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  if (!isAdminRequest(request)) {
    const gate = adminGateResponse();
    return fail(gate.error, gate.status);
  }
  const body = await readJson(request);
  if (!body) return fail('invalid_json', 400);
  const deviceId = cleanString(body.device_id, 64);
  if (!deviceId) return fail('device_id_required', 400);
  try {
    const request = await requestLending({
      deviceId,
      enabled: body.enabled === true,
      cpuPct: body.cpu_pct ?? null,
      minutesPerHour: body.minutes_per_hour ?? null,
      unitsPerHour: body.units_per_hour ?? null,
    });
    return json({ ok: true, lending_request: request }, 202);
  } catch (error) {
    const message = error.message || 'lending_request_failed';
    return fail(message, message === 'device_not_found' ? 404 : 400);
  }
}
