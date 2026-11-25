export function offlineSeconds() {
  const value = Number(process.env.PRIMAL_OFFLINE_SECONDS);
  return Number.isFinite(value) && value > 0 ? value : 90;
}

export function deviceStatus(device, now = Date.now()) {
  const last = device.last_heartbeat ? Date.parse(device.last_heartbeat) : null;
  const disconnected = device.disconnected_at ? Date.parse(device.disconnected_at) : null;
  const fresh = last !== null && Number.isFinite(last) && now - last <= offlineSeconds() * 1000;

  if (disconnected !== null && Number.isFinite(disconnected) && (last === null || disconnected >= last)) {
    return 'offline';
  }
  if (fresh) return device.worker?.status === 'running' ? 'executing' : 'connected';
  if (last !== null && Number.isFinite(last)) return 'offline';
  return 'registered';
}

export function deviceView(device, now = Date.now()) {
  const last = device.last_heartbeat ? Date.parse(device.last_heartbeat) : null;
  return {
    id: device.id,
    name: device.name,
    manufacturer: device.manufacturer ?? null,
    model: device.model ?? null,
    android_version: device.android_version ?? null,
    android_sdk: device.android_sdk ?? null,
    cpu_arch: device.cpu_arch ?? null,
    cpu_cores: device.cpu_cores ?? null,
    cli_version: device.cli_version ?? null,
    workloads: Array.isArray(device.workloads) ? device.workloads : [],
    registered_at: device.registered_at ?? null,
    last_heartbeat: device.last_heartbeat ?? null,
    heartbeat_age_seconds:
      last !== null && Number.isFinite(last) ? Math.max(0, Math.round((now - last) / 1000)) : null,
    disconnected_at: device.disconnected_at ?? null,
    status: deviceStatus(device, now),
    offline_after_seconds: offlineSeconds(),
    metrics: device.metrics ?? {},
    profile: {
      name: device.profile?.name ?? '',
      status: device.profile?.status ?? '',
      avatar: device.profile?.avatar ?? '',
      updated_at: device.profile?.updated_at ?? null,
    },
    wallet: {
      balance: device.credits?.balance ?? device.wallet?.balance ?? 0,
      earned_total: device.credits?.earned_total ?? device.wallet?.earned_total ?? 0,
      spent_total: device.credits?.spent_total ?? device.wallet?.spent_total ?? 0,
      units: device.credits?.units ?? 0,
      total_units: device.credits?.total_units ?? 0,
      updated_at: device.credits?.updated_at ?? device.wallet?.updated_at ?? null,
    },
    caps: {
      day_minutes: device.caps?.day_minutes ?? null,
      week_minutes: device.caps?.week_minutes ?? null,
      month_minutes: device.caps?.month_minutes ?? null,
      day_used: device.caps?.day_used ?? 0,
      week_used: device.caps?.week_used ?? 0,
      month_used: device.caps?.month_used ?? 0,
    },
    agent: {
      name: device.agent?.name ?? '',
      enabled: device.agent?.enabled === true,
      model: device.agent?.model ?? '',
      account: device.agent?.account ?? '',
      connected: device.agent?.connected === true,
      updated_at: device.agent?.updated_at ?? null,
    },
    lending: {
      enabled: device.lending?.enabled === true,
      cpu_pct: device.lending?.cpu_pct ?? 20,
      minutes_per_hour: device.lending?.minutes_per_hour ?? 30,
      units_per_hour: device.lending?.units_per_hour ?? 1,
      updated_at: device.lending?.updated_at ?? null,
      request: device.lending_request ?? null,
    },
    credits: {
      units: device.credits?.units ?? 0,
      total_units: device.credits?.total_units ?? 0,
      minutes_used: device.credits?.minutes_used ?? 0,
      window_start: device.credits?.window_start ?? null,
      updated_at: device.credits?.updated_at ?? null,
    },
    worker: {
      status: device.worker?.status ?? 'stopped',
      compute_enabled: device.worker?.compute_enabled === true,
      paused: device.worker?.paused === true,
      current_task_id: device.worker?.current_task_id ?? null,
      updated_at: device.worker?.updated_at ?? null,
      last_error: device.worker?.last_error ?? null,
      last_result: device.worker?.last_result ?? null,
    },
  };
}

export function summarize(devices, tasks, now = Date.now()) {
  const views = Object.values(devices).map((device) => deviceView(device, now));
  const connected = views.filter((device) => ['connected', 'executing'].includes(device.status));
  const activeTasks = Object.values(tasks).filter((task) =>
    ['pending', 'claimed', 'executing'].includes(task.status)
  );

  return {
    total_registered: views.length,
    connected: connected.length,
    offline: views.filter((device) => device.status === 'offline').length,
    registered_only: views.filter((device) => device.status === 'registered').length,
    executing: views.filter((device) => device.status === 'executing').length,
    active_workers: connected.filter(
      (device) => device.worker.compute_enabled && ['idle', 'running'].includes(device.worker.status)
    ).length,
    total_available_ram_mb: connected.reduce(
      (total, device) => total + (Number(device.metrics?.ram_available_mb) || 0),
      0
    ),
    active_tasks: activeTasks.length,
    lending_devices: views.filter((device) => device.lending.enabled).length,
    total_compute_units: Math.round(
      views.reduce((total, device) => total + (Number(device.credits.total_units) || 0), 0) * 1000
    ) / 1000,
    available_compute_units: Math.round(
      views.reduce((total, device) => total + (Number(device.credits.units) || 0), 0) * 1000
    ) / 1000,
    offline_after_seconds: offlineSeconds(),
    server_time: new Date(now).toISOString(),
  };
}

export function walletHistory(device, limit = 60) {
  const history = Array.isArray(device?.wallet_history) ? device.wallet_history : [];
  return history.slice(-limit);
}
