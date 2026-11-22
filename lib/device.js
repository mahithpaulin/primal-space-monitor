import { cleanString, finiteNumber, intOrNull } from './http.js';

export function sanitizeDeviceInfo(input = {}) {
  return {
    name: cleanString(input.name, 64) || 'Unnamed device',
    manufacturer: cleanString(input.manufacturer, 64),
    model: cleanString(input.model, 64),
    android_version: cleanString(input.android_version, 32),
    android_sdk: intOrNull(input.android_sdk, 1, 100),
    cpu_arch: cleanString(input.cpu_arch, 32),
    cpu_cores: intOrNull(input.cpu_cores, 1, 128),
    cli_version: cleanString(input.cli_version, 32),
  };
}

export function sanitizeMetrics(input = {}) {
  const ramTotal = finiteNumber(input.ram_total_mb, 1, 1048576);
  const ramAvailable = finiteNumber(input.ram_available_mb, 0, 1048576);
  const usableAvailable =
    ramTotal !== null && ramAvailable !== null ? Math.min(ramAvailable, ramTotal) : null;
  const ramUsedPct =
    ramTotal !== null && usableAvailable !== null
      ? Math.round(((ramTotal - usableAvailable) / ramTotal) * 1000) / 10
      : null;

  return {
    cpu_usage_pct: finiteNumber(input.cpu_usage_pct, 0, 100),
    cpu_load_pct: finiteNumber(input.cpu_load_pct, 0, 1000),
    ram_total_mb: ramTotal === null ? null : Math.round(ramTotal),
    ram_available_mb: usableAvailable === null ? null : Math.round(usableAvailable),
    ram_used_pct: ramUsedPct,
    storage_free_mb: finiteNumber(input.storage_free_mb, 0, 10485760),
    battery_pct: finiteNumber(input.battery_pct, 0, 100),
    charging: typeof input.charging === 'boolean' ? input.charging : null,
    network_connected:
      typeof input.network_connected === 'boolean' ? input.network_connected : null,
    network_type: ['wifi', 'cellular', 'ethernet', 'unknown', 'none'].includes(input.network_type)
      ? input.network_type
      : 'unknown',
  };
}

export function sanitizeWorker(input = {}) {
  const statuses = ['starting', 'idle', 'running', 'paused', 'disabled', 'stopped', 'error'];
  let lastResult = null;
  if (input.last_result && typeof input.last_result === 'object') {
    lastResult = {
      task_id: cleanString(input.last_result.task_id, 64),
      status: cleanString(input.last_result.status, 32),
      value: finiteNumber(input.last_result.value, 0, Number.MAX_SAFE_INTEGER),
      verified: typeof input.last_result.verified === 'boolean' ? input.last_result.verified : null,
      duration_ms: finiteNumber(input.last_result.duration_ms, 0, 86400000),
      completed_at: cleanString(input.last_result.completed_at, 40),
    };
  }
  return {
    status: statuses.includes(input.status) ? input.status : 'stopped',
    compute_enabled: input.compute_enabled === true,
    paused: input.paused === true,
    current_task_id: cleanString(input.current_task_id, 64),
    updated_at: cleanString(input.updated_at, 40),
    last_error: cleanString(input.last_error, 200),
    last_result: lastResult,
  };
}

export function sanitizeLending(input = {}) {
  if (!input || typeof input !== 'object') {
    return { enabled: false, cpu_pct: 20, minutes_per_hour: 30, units_per_hour: 1 };
  }
  const enabled = input.enabled === true;
  const cpu = finiteNumber(input.cpu_pct, 20, 1, 100);
  const minutes = finiteNumber(input.minutes_per_hour, 30, 1, 60);
  const units = finiteNumber(input.units_per_hour, 1, 0.01, 100);
  return {
    enabled,
    cpu_pct: cpu === null ? 20 : Math.round(cpu),
    minutes_per_hour: minutes === null ? 30 : Math.round(minutes),
    units_per_hour: units === null ? 1 : Math.round(units * 1000) / 1000,
  };
}

export function sanitizeCredits(input = {}) {
  if (!input || typeof input !== 'object') {
    return { units: 0, total_units: 0, minutes_used: 0, window_start: null, updated_at: null };
  }
  const units = finiteNumber(input.units, 0, 1e9);
  const total = finiteNumber(input.total_units, 0, 1e9);
  const minutes = finiteNumber(input.minutes_used, 0, 60);
  return {
    units: units === null ? 0 : Math.round(units * 1000) / 1000,
    total_units: total === null ? 0 : Math.round(total * 1000) / 1000,
    minutes_used: minutes === null ? 0 : Math.round(minutes * 100) / 100,
    window_start: cleanString(input.window_start, 40) || null,
    updated_at: cleanString(input.updated_at, 40) || null,
  };
}
