import crypto from 'node:crypto';
import { withState } from '../../../../lib/store.js';
import { hashToken, newToken } from '../../../../lib/auth.js';
import { sanitizeDeviceInfo } from '../../../../lib/device.js';
import { cleanString, json, fail, readJson } from '../../../../lib/http.js';
import { offlineSeconds } from '../../../../lib/status.js';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const body = await readJson(request);
  if (!body) return fail('invalid_json', 400);

  const installId = cleanString(body.install_id, 64);
  if (!installId) return fail('install_id_required', 400);

  const info = sanitizeDeviceInfo(body.device);
  const enrollmentKey = crypto.randomBytes(24).toString('base64url');
  const token = newToken();
  const tokenHash = hashToken(token);
  const now = new Date().toISOString();

  const result = await withState((state) => {
    const existing = Object.values(state.devices).find((item) => item.install_id === installId);
    if (existing) {
      Object.assign(existing, info, {
        token_hash: tokenHash,
        last_heartbeat: existing.last_heartbeat ?? null,
        disconnected_at: null,
        worker: {
          ...(existing.worker || {}),
          status: 'stopped',
          current_task_id: null,
          updated_at: now,
        },
      });
      return {
        device_id: existing.id,
        token,
        enrollment_key: enrollmentKey,
        status: 'registered',
        server_time: now,
        offline_after_seconds: offlineSeconds(),
      };
    }

    const id = crypto.randomUUID();
    state.devices[id] = {
      id,
      install_id: installId,
      ...info,
      token_hash: tokenHash,
      registered_at: now,
      last_heartbeat: null,
      disconnected_at: null,
      metrics: {},
      worker: {
        status: 'stopped',
        compute_enabled: false,
        paused: false,
        current_task_id: null,
        updated_at: now,
        last_error: null,
        last_result: null,
      },
    };
    return {
      device_id: id,
      token,
      enrollment_key: enrollmentKey,
      status: 'registered',
      server_time: now,
      offline_after_seconds: offlineSeconds(),
    };
  });

  return json(result, 201);
}
