import crypto from 'node:crypto';

export function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ''), 'utf8');
  const right = Buffer.from(String(b ?? ''), 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function bearerToken(request) {
  const header = request.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export function authenticateDevice(state, request, deviceId) {
  const device = state.devices[deviceId];
  if (!device) return { error: 'device_not_found', status: 404 };
  const token = bearerToken(request);
  if (!token || !safeEqual(hashToken(token), device.token_hash)) {
    return { error: 'invalid_device_token', status: 401 };
  }
  return { device };
}
