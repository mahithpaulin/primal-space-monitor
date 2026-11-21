import { readState } from '../../../../lib/store.js';
import { deviceView, summarize } from '../../../../lib/status.js';
import { adminGateResponse, isAdminRequest } from '../../../../lib/admin.js';
import { json, fail } from '../../../../lib/http.js';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  if (!isAdminRequest(request)) {
    const gate = adminGateResponse();
    return fail(gate.error, gate.status);
  }
  const state = await readState();
  const now = Date.now();
  return json({
    summary: summarize(state.devices, state.tasks, now),
    devices: Object.values(state.devices)
      .map((device) => deviceView(device, now))
      .sort((a, b) => a.name.localeCompare(b.name)),
  });
}
