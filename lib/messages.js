import crypto from 'node:crypto';

export const MAX_MESSAGE_BODY = 4000;
export const MAX_MESSAGES = 200;

export function createMessage({ from, to = null, topic = 'chat', body, group_id = null }) {
  const text = typeof body === 'string' ? body.trim() : '';
  if (!text) throw new Error('message_body_required');
  if (Buffer.byteLength(text, 'utf8') > MAX_MESSAGE_BODY) throw new Error('message_too_large');
  const message = {
    id: crypto.randomUUID(),
    from: from || 'operator',
    to: to || null,
    topic: typeof topic === 'string' && topic.trim() ? topic.trim().slice(0, 64) : 'chat',
    body: text,
    created_at: new Date().toISOString(),
  };
  const group = typeof group_id === 'string' && group_id.trim() ? group_id.trim().slice(0, 64) : null;
  if (group) message.group_id = group;
  return message;
}

export function messageView(message) {
  const view = {
    id: message.id,
    from: message.from,
    to: message.to,
    topic: message.topic,
    body: message.body,
    created_at: message.created_at,
  };
  if (message.credit && typeof message.credit === 'object') {
    view.credit = {
      kind: String(message.credit.kind || ''),
      amount: Number(message.credit.amount || 0),
      transfer_id: message.credit.transfer_id || null,
    };
  }
  if (message.group_id) view.group_id = message.group_id;
  return view;
}

export function listInbox(state, deviceId, { since = null, limit = 50 } = {}) {
  const cursor = since ? Date.parse(since) : null;
  return Object.values(state.messages || {})
    .filter((message) => message.to === null || message.to === deviceId)
    .filter((message) => !cursor || Date.parse(message.created_at) > cursor)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
    .slice(-Math.min(100, Math.max(1, limit)))
    .map(messageView);
}

export function listAll(state, limit = 100) {
  return Object.values(state.messages || {})
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, Math.min(200, Math.max(1, limit)))
    .map(messageView);
}
