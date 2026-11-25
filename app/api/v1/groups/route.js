import { withState } from '../../../../lib/store.js';
import { authenticateDevice } from '../../../../lib/auth.js';
import { isAdminRequest } from '../../../../lib/admin.js';
import { cleanString, json, fail, readJson } from '../../../../lib/http.js';
import { createGroup, groupView, listGroupsForDevice } from '../../../../lib/groups.js';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const url = new URL(request.url);
  if (isAdminRequest(request)) {
    const state = await withState((current) => current);
    const groups = Object.values(state.groups || {})
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .map((group) => groupView(state, group));
    return json({ groups, scope: 'all' });
  }
  const deviceId = cleanString(url.searchParams.get('device_id'), 64);
  if (!deviceId) return fail('device_id_required', 400);
  const result = await withState((state) => {
    const auth = authenticateDevice(state, request, deviceId);
    if (auth.error) return auth;
    return { groups: listGroupsForDevice(state, deviceId) };
  });
  if (result.error) return fail(result.error, result.status);
  return json(result);
}

export async function POST(request) {
  const body = await readJson(request);
  if (!body) return fail('invalid_json', 400);
  const deviceId = cleanString(body.device_id, 64);
  if (!deviceId) return fail('device_id_required', 400);
  const result = await withState((state) => {
    const auth = authenticateDevice(state, request, deviceId);
    if (auth.error) return auth;
    const members = Array.isArray(body.members) ? body.members : [];
    for (const member of members) {
      const id = cleanString(member, 64);
      if (id && !state.devices[id]) return { error: 'device_not_found', status: 404 };
    }
    let group;
    try {
      group = createGroup({ name: body.name, members, owner: deviceId, topic: body.topic });
    } catch (error) {
      return { error: error.message, status: 400 };
    }
    state.groups[group.id] = group;
    return { group: groupView(state, group) };
  });
  if (result.error) return fail(result.error, result.status);
  return json(result, 201);
}
