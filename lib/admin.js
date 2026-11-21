import crypto from 'node:crypto';

export const ADMIN_COOKIE = 'primal_admin';
export const ADMIN_HEADER = 'x-primal-admin-key';

export function adminKey() {
  const value = process.env.PRIMAL_ADMIN_KEY;
  return typeof value === 'string' && value.length >= 16 ? value : null;
}

export function adminEnabled() {
  return adminKey() !== null;
}

export function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ''), 'utf8');
  const right = Buffer.from(String(b ?? ''), 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function requestAdminKey(request) {
  const header = request?.headers?.get(ADMIN_HEADER);
  if (header) return header.trim();
  const cookie = request?.cookies?.get?.(ADMIN_COOKIE);
  return cookie ? cookie.value : null;
}

export function isAdminRequest(request) {
  const key = adminKey();
  if (!key) return true;
  const provided = requestAdminKey(request);
  return provided !== null && safeEqual(provided, key);
}

export function adminGateResponse() {
  return { error: 'admin_required', status: 401 };
}
