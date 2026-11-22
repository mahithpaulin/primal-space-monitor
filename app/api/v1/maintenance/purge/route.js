import { purgeWorkloads } from '../../../../../lib/actions.js';
import { adminGateResponse, isAdminRequest } from '../../../../../lib/admin.js';
import { json, fail, readJson } from '../../../../../lib/http.js';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  if (!isAdminRequest(request)) {
    const gate = adminGateResponse();
    return fail(gate.error, gate.status);
  }
  const body = await readJson(request);
  if (!body) return fail('invalid_json', 400);
  try {
    const removed = await purgeWorkloads(body.workloads);
    return json({ ok: true, ...removed });
  } catch (error) {
    return fail(error.message || 'purge_failed', 400);
  }
}
