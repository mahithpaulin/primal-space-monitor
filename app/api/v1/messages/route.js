import { withState, pruneMessages } from '../../../../lib/store.js';
import { authenticateDevice } from '../../../../lib/auth.js';
import { isAdminRequest, adminGateResponse } from '../../../../lib/admin.js';
import { createMessage, listAll, listInbox, messageView } from '../../../../lib/messages.js';
import { findGroup, groupIdFromTarget, groupRecipients, isGroupTarget } from '../../../../lib/groups.js';
import { cleanString, json, fail, readJson } from '../../../../lib/http.js';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const url = new URL(request.url);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));

  if (isAdminRequest(request)) {
    const state = await withState((current) => current);
    return json({ messages: listAll(state, limit), scope: 'all' });
  }

  const deviceId = cleanString(url.searchParams.get('device_id'), 64);
  if (!deviceId) return fail('device_id_required', 400);
  const since = cleanString(url.searchParams.get('since'), 40);
  const result = await withState((state) => {
    const auth = authenticateDevice(state, request, deviceId);
    if (auth.error) return auth;
    return { messages: listInbox(state, deviceId, { since, limit }) };
  });
  if (result.error) return fail(result.error, result.status);
  return json(result);
}

export async function POST(request) {
  const body = await readJson(request);
  if (!body) return fail('invalid_json', 400);
  const bodyText = typeof body.body === 'string' ? body.body : '';
  const topic = cleanString(body.topic, 64) || 'chat';
  const target = cleanString(body.to, 64);

  if (isAdminRequest(request)) {
    const created = await withState((state) => {
      if (isGroupTarget(target)) {
        const group = findGroup(state, groupIdFromTarget(target));
        if (!group) return { error: 'group_not_found', status: 404 };
        const messages = groupRecipients(group, 'operator').map((recipient) => {
          const message = createMessage({
            from: 'operator',
            to: recipient,
            topic,
            body: bodyText,
            group_id: group.id,
          });
          state.messages[message.id] = message;
          return message;
        });
        pruneMessages(state);
        return { messages: messages.map(messageView), group_id: group.id };
      }
      if (target && !state.devices[target]) return { error: 'device_not_found', status: 404 };
      const message = createMessage({ from: 'operator', to: target || null, topic, body: bodyText });
      state.messages[message.id] = message;
      pruneMessages(state);
      return { message: messageView(message) };
    });
    if (created.error) return fail(created.error, created.status);
    return json(created, 201);
  }

  const deviceId = cleanString(body.device_id, 64);
  if (!deviceId) return fail('device_id_required', 400);
  const created = await withState((state) => {
    const auth = authenticateDevice(state, request, deviceId);
    if (auth.error) return auth;
    if (isGroupTarget(target)) {
      const group = findGroup(state, groupIdFromTarget(target));
      if (!group) return { error: 'group_not_found', status: 404 };
      if (!(group.members || []).includes(deviceId)) return { error: 'group_forbidden', status: 403 };
      const messages = groupRecipients(group, deviceId).map((recipient) => {
        const message = createMessage({
          from: deviceId,
          to: recipient,
          topic,
          body: bodyText,
          group_id: group.id,
        });
        state.messages[message.id] = message;
        return message;
      });
      pruneMessages(state);
      return { messages: messages.map(messageView), group_id: group.id };
    }
    if (target && !state.devices[target]) return { error: 'device_not_found', status: 404 };
    const message = createMessage({ from: deviceId, to: target || null, topic, body: bodyText });
    state.messages[message.id] = message;
    pruneMessages(state);
    return { message: messageView(message) };
  });
  if (created.error) return fail(created.error, created.status);
  return json(created, 201);
}

export async function DELETE(request) {
  if (!isAdminRequest(request)) {
    const gate = adminGateResponse();
    return fail(gate.error, gate.status);
  }
  const removed = await withState((state) => {
    const count = Object.keys(state.messages || {}).length;
    state.messages = {};
    return { removed: count };
  });
  return json(removed);
}
