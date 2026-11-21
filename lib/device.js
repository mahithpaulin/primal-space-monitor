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
