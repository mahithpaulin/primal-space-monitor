import { withState } from '../../../../lib/store.js';
import { authenticateDevice } from '../../../../lib/auth.js';
import { sanitizeAgent, sanitizeCaps, sanitizeLending, sanitizeMetrics, sanitizeProfile, sanitizeWallet, sanitizeWorker } from '../../../../lib/device.js';
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
    const profile = sanitizeProfile(body.profile);
    const wallet = sanitizeWallet(body.wallet);
    const caps = sanitizeCaps(body.caps);
    const agent = sanitizeAgent(body.agent);

    device.metrics = metrics;
    device.worker = worker;
    device.last_heartbeat = now;
    device.disconnected_at = null;
    if (cliVersion) device.cli_version = cliVersion;
    if (Object.prototype.hasOwnProperty.call(body, 'workloads')) device.workloads = workloads;
    if (Object.prototype.hasOwnProperty.call(body, 'lending')) {
      device.lending = { ...lending, updated_at: now };
    }
    const settled = device.credits || {};
    const finiteOrZero = (value) => {
      const number = Number(value ?? 0);
      return Number.isFinite(number) ? number : 0;
    };
    const settledBalance = finiteOrZero(settled.balance);
    const settledEarned = finiteOrZero(settled.earned_total);
    const settledSpent = finiteOrZero(settled.spent_total);
    device.credits = {
      ...settled,
      units: Number(settled.units ?? 0),
      total_units: Number(settled.total_units ?? 0),
      minutes_used: Number(settled.minutes_used ?? 0),
      window_start: settled.window_start ?? null,
      balance: settledBalance,
      earned_total: settledEarned,
      spent_total: settledSpent,
      updated_at: now,
    };
    if (Object.prototype.hasOwnProperty.call(body, 'profile')) {
      device.profile = { ...profile, updated_at: now };
    }
    device.wallet = {
      ...wallet,
      balance: settledBalance,
      earned_total: settledEarned,
      spent_total: settledSpent,
      units: Number(settled.units ?? 0),
      total_units: Number(settled.total_units ?? 0),
      updated_at: now,
    };
    if (Object.prototype.hasOwnProperty.call(body, 'caps')) device.caps = caps;
    if (Object.prototype.hasOwnProperty.call(body, 'agent')) {
      device.agent = { ...agent, updated_at: now };
    }
    device.wallet_history = Array.isArray(device.wallet_history) ? device.wallet_history.slice(-240) : [];
    const previousHistory = device.wallet_history[device.wallet_history.length - 1];
    if (
      !previousHistory ||
      Number(previousHistory.balance) !== settledBalance ||
      Number(previousHistory.earned) !== settledEarned
    ) {
      device.wallet_history.push({
        at: now,
        balance: settledBalance,
        earned: settledEarned,
      });
    }

    return {
      ok: true,
      device_id: device.id,
      server_time: now,
      offline_after_seconds: offlineSeconds(),
      status: deviceStatus(device),
      wallet: device.wallet,
      credits: device.credits,
      lending_request: device.lending_request ?? null,
    };
  });

  if (!result.ok) return fail(result.error, result.status);
  return json(result);
}
