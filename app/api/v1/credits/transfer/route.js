import { withState, pruneMessages, pruneCreditEvents } from '../../../../lib/store.js';
import { settleTransfer, transferView } from '../../../../lib/credits.js';
import { adminGateResponse, isAdminRequest } from '../../../../lib/admin.js';
import { cleanString, json, fail, readJson } from '../../../../lib/http.js';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  if (!isAdminRequest(request)) {
    const gate = adminGateResponse();
    return fail(gate.error, gate.status);
  }
  const body = await readJson(request);
  if (!body) return fail('invalid_json', 400);
  const from = cleanString(body.from, 64);
  const to = cleanString(body.to, 64);
  const note = cleanString(body.note, 200);
  if (!from || !to) return fail('transfer_devices_required', 400);

  const result = await withState((state) => {
    try {
      const transfer = settleTransfer(state, { from, to, amount: body.amount, note });
      pruneMessages(state);
      pruneCreditEvents(state);
      return { transfer: transferView(transfer) };
    } catch (error) {
      return { error: error.message || 'transfer_failed' };
    }
  });

  if (result.error) {
    const status =
      result.error === 'device_not_found' ? 404 : result.error === 'insufficient_balance' ? 409 : 400;
    return fail(result.error, status);
  }
  return json(result, 201);
}
