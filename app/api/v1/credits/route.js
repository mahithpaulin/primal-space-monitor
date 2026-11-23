import { withStateRead } from '../../../../lib/store.js';
import { currencySummary, listTransfers } from '../../../../lib/credits.js';
import { adminGateResponse, isAdminRequest } from '../../../../lib/admin.js';
import { json, fail } from '../../../../lib/http.js';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  if (!isAdminRequest(request)) {
    const gate = adminGateResponse();
    return fail(gate.error, gate.status);
  }
  const url = new URL(request.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));
  const state = await withStateRead((current) => current);
  return json({
    summary: currencySummary(state, state.devices),
    transfers: listTransfers(state, limit),
  });
}
