import { NextResponse } from 'next/server';

export function json(data, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export function fail(error, status = 400) {
  return json({ error }, status);
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function cleanString(value, maxLength) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

export function finiteNumber(value, min, max) {
  if (value === null || value === undefined || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return null;
  if (number < min || number > max) return null;
  return number;
}

export function intOrNull(value, min, max) {
  const number = finiteNumber(value, min, max);
  return number === null ? null : Math.round(number);
}
