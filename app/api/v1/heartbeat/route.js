import { withState } from '../../../../lib/store.js';
import { authenticateDevice } from '../../../../lib/auth.js';
import { sanitizeCaps, sanitizeCredits, sanitizeLending, sanitizeMetrics, sanitizeProfile, sanitizeWallet, sanitizeWorker } from '../../../../lib/device.js';
import { cleanString, json, fail, readJson } from '../../../../lib/http.js';
import { deviceStatus, offlineSeconds } from '../../../../lib/status.js';
import { normalizeWorkloads } from '../../../../lib/workloads.js';

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
    const workloads = normalizeWorkloads(body.workloads);
    const lending = sanitizeLending(body.lending);
    const credits = sanitizeCredits(body.credits);
    const profile = sanitizeProfile(body.profile);
    const wallet = sanitizeWallet(body.wallet);
    const caps = sanitizeCaps(body.caps);

    device.metrics = metrics;
    device.worker = worker;
    device.last_heartbeat = now;
    device.disconnected_at = null;
    if (cliVersion) device.cli_version = cliVersion;
    if (workloads.length) device.workloads = workloads;
    device.lending = { ...lending, updated_at: now };
    device.credits = credits;
    device.profile = { ...profile, updated_at: now };
    device.wallet = { ...wallet, updated_at: now };
    device.caps = caps;
    device.wallet_history = Array.isArray(device.wallet_history) ? device.wallet_history.slice(-240) : [];
    device.wallet_history.push({
      at: now,
      balance: credits.units,
      earned: credits.total_units,
    });

    return {
      ok: true,
      device_id: device.id,
      server_time: now,
      offline_after_seconds: offlineSeconds(),
      status: deviceStatus(device),
      lending_request: device.lending_request ?? null,
    };
  });

  if (!result.ok) return fail(result.error, result.status);
  return json(result);
}
