import { withStateRead } from '../../../../lib/store.js';
import { authenticateDevice } from '../../../../lib/auth.js';
import { deviceStatus } from '../../../../lib/status.js';
import { cleanString, json, fail } from '../../../../lib/http.js';
import { normalizeWorkloads } from '../../../../lib/workloads.js';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const url = new URL(request.url);
  const deviceId = cleanString(url.searchParams.get('device_id'), 64);
  if (!deviceId) return fail('device_id_required', 400);
  const result = await withStateRead((state) => {
    const auth = authenticateDevice(state, request, deviceId);
    if (auth.error) return auth;
    const peers = Object.values(state.devices)
      .filter((device) => device.id !== deviceId)
      .map((device) => ({
        id: device.id,
        name: device.name,
        status: deviceStatus(device),
        workloads: normalizeWorkloads(device.workloads),
        profile: {
          name: device.profile?.name ?? '',
          status: device.profile?.status ?? '',
          avatar: device.profile?.avatar ?? '',
        },
        balance: device.credits?.balance ?? device.wallet?.balance ?? 0,
        wallet: {
          balance: device.credits?.balance ?? device.wallet?.balance ?? 0,
          earned_total: device.credits?.earned_total ?? device.wallet?.earned_total ?? 0,
          spent_total: device.credits?.spent_total ?? device.wallet?.spent_total ?? 0,
          units: device.credits?.units ?? 0,
          total_units: device.credits?.total_units ?? 0,
        },
        lending: device.lending?.enabled === true,
        last_heartbeat_at: device.last_heartbeat ?? null,
      }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return { peers };
  });
  if (result.error) return fail(result.error, result.status);
  return json(result);
}
