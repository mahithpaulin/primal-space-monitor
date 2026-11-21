'use client';

import { useEffect, useState, useTransition } from 'react';
import { enqueueBenchmarkAction, cancelTaskAction } from './actions.js';

const STATUS_LABELS = {
  registered: 'Registered',
  connected: 'Connected',
  executing: 'Executing task',
  offline: 'Offline',
};

function formatMb(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  const mb = Number(value);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

function formatPct(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return `${Math.round(Number(value))}%`;
}

function formatAge(iso) {
  if (!iso) return 'never';
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function formatTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function shortId(id) {
  return id ? id.slice(0, 8) : '—';
}

function StatusPill({ status }) {
  return (
    <span className={`pill status-${status}`}>
      <span className="dot" />
      {STATUS_LABELS[status] || status}
    </span>
  );
}

function StatCard({ label, value, detail }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {detail ? <div className="stat-detail">{detail}</div> : null}
    </div>
  );
}

function DeviceCard({ device, adminKey, pending, onQueue, onCancel }) {
  const metrics = device.metrics || {};
  const worker = device.worker || {};
  const ramTotal = metrics.ram_total_mb;
  const ramAvailable = metrics.ram_available_mb;
  const ramUsed =
    ramTotal !== null && ramTotal !== undefined && ramAvailable !== null && ramAvailable !== undefined
      ? Math.max(0, ramTotal - ramAvailable)
      : null;
  const ramPct = ramTotal ? Math.min(100, Math.max(0, (ramUsed / ramTotal) * 100)) : 0;
  const activeTask = ['claimed', 'executing'].includes(
    device.status === 'executing' ? 'executing' : ''
  );
  const canQueue = ['connected', 'executing'].includes(device.status);

  return (
    <article className="device-card">
      <div className="device-head">
        <div>
          <h3>{device.name}</h3>
          <p className="muted">
            {[device.manufacturer, device.model].filter(Boolean).join(' ') || 'Unknown device'}
          </p>
        </div>
        <StatusPill status={device.status} />
      </div>

      <dl className="device-grid">
        <div>
          <dt>Android</dt>
          <dd>{device.android_version ? `Android ${device.android_version}` : '—'}</dd>
        </div>
        <div>
          <dt>CPU</dt>
          <dd>
            {device.cpu_arch || '—'} · {device.cpu_cores ?? '—'} cores ·{' '}
            {formatPct(metrics.cpu_usage_pct)} used
          </dd>
        </div>
        <div>
          <dt>RAM</dt>
          <dd>
            {ramUsed !== null ? `${formatMb(ramUsed)} / ${formatMb(ramTotal)}` : formatMb(ramTotal)}
            <span className="muted"> ({formatPct(metrics.ram_used_pct)})</span>
          </dd>
        </div>
        <div>
          <dt>Storage free</dt>
          <dd>{formatMb(metrics.storage_free_mb)}</dd>
        </div>
        <div>
          <dt>Battery</dt>
          <dd>
            {formatPct(metrics.battery_pct)}
            {metrics.charging === true ? ' · charging' : metrics.charging === false ? ' · discharging' : ''}
          </dd>
        </div>
        <div>
          <dt>Network</dt>
          <dd>
            {metrics.network_connected === true
              ? metrics.network_type || 'connected'
              : metrics.network_connected === false
                ? 'offline'
                : '—'}
          </dd>
        </div>
        <div>
          <dt>Last heartbeat</dt>
          <dd title={formatTime(device.last_heartbeat)}>{formatAge(device.last_heartbeat)}</dd>
        </div>
        <div>
          <dt>Worker</dt>
          <dd>
            {worker.status || 'stopped'}
            {worker.compute_enabled ? ' · enabled' : ' · compute disabled'}
            {worker.paused ? ' · paused' : ''}
          </dd>
        </div>
      </dl>

      <div className="ram-bar" aria-label="RAM utilization">
        <span style={{ width: `${ramPct}%` }} />
      </div>

      <div className="device-actions">
        <button
          type="button"
          className="primary"
          disabled={!canQueue || pending}
          onClick={() => onQueue(device.id)}
        >
          Queue benchmark
        </button>
        {worker.current_task_id ? (
          <button
            type="button"
            className="danger"
            disabled={pending}
            onClick={() => onCancel(worker.current_task_id)}
          >
            Cancel {shortId(worker.current_task_id)}
          </button>
        ) : null}
        <span className="muted small">
          {device.status === 'offline'
            ? `Offline after ${device.offline_after_seconds}s without heartbeat`
            : canQueue
              ? 'Compute requires local opt-in on the device'
              : 'Waiting for first heartbeat'}
        </span>
      </div>
    </article>
  );
}

function TaskTable({ tasks, adminKey, pending, onCancel }) {
  if (!tasks.length) {
    return <p className="muted empty">No tasks yet. Queue a benchmark from a connected device.</p>;
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Task</th>
            <th>Device</th>
            <th>Status</th>
            <th>Verified</th>
            <th>Duration</th>
            <th>Result</th>
            <th>Created</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.id}>
              <td className="mono">{shortId(task.id)}</td>
              <td>{task.device_name || shortId(task.device_id)}</td>
              <td>
                <span className={`task-status task-${task.status}`}>{task.status}</span>
              </td>
              <td>
                {task.verified === true ? 'yes' : task.verified === false ? 'no' : '—'}
              </td>
              <td>{task.duration_ms !== null && task.duration_ms !== undefined ? `${(task.duration_ms / 1000).toFixed(2)}s` : '—'}</td>
              <td className="mono">{task.result_value ?? '—'}</td>
              <td className="muted">{formatTime(task.created_at)}</td>
              <td>
                {['pending', 'claimed', 'executing'].includes(task.status) ? (
                  <button
                    type="button"
                    className="ghost small"
                    disabled={pending}
                    onClick={() => onCancel(task.id)}
                  >
                    Cancel
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Dashboard({ initialDevices, initialTasks, initialSummary }) {
  const [devices, setDevices] = useState(initialDevices);
  const [tasks, setTasks] = useState(initialTasks);
  const [summary, setSummary] = useState(initialSummary);
  const [adminKey, setAdminKey] = useState('');
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(Date.now());
  const [pending, startTransition] = useTransition();

  async function refresh() {
    try {
      const [devicesResponse, tasksResponse] = await Promise.all([
        fetch('/api/v1/devices', { cache: 'no-store' }),
        fetch('/api/v1/tasks?limit=20', { cache: 'no-store' }),
      ]);
      if (!devicesResponse.ok || !tasksResponse.ok) throw new Error('Monitor API unavailable');
      const devicesPayload = await devicesResponse.json();
      const tasksPayload = await tasksResponse.json();
      setDevices(devicesPayload.devices || []);
      setSummary(devicesPayload.summary || {});
      setTasks(tasksPayload.tasks || []);
      setLastUpdated(Date.now());
      setError(null);
    } catch (fetchError) {
      setError(fetchError.message);
    }
  }

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      await refresh();
    };
    poll();
    const interval = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  function queueBenchmark(deviceId) {
    startTransition(async () => {
      const result = await enqueueBenchmarkAction({ deviceId, adminKey });
      setNotice(result.ok ? result.message : result.error);
      if (result.ok) refresh();
    });
  }

  function cancelTask(taskId) {
    startTransition(async () => {
      const result = await cancelTaskAction({ taskId, adminKey });
      setNotice(result.ok ? result.message : result.error);
      if (result.ok) refresh();
    });
  }

  const connected = summary?.connected ?? 0;
  const offline = summary?.offline ?? 0;
  const registeredOnly = summary?.registered_only ?? 0;

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="brand">
            <span className="brand-mark" />
            PRIMAL SPACE
          </div>
          <p className="muted">Device connection test · v0.1</p>
        </div>
        <div className="topbar-right">
          <span className={`live ${error ? 'live-error' : ''}`}>
            <span className="dot" />
            {error ? 'API error' : 'live'}
          </span>
          <span className="muted small">updated {formatAge(new Date(lastUpdated).toISOString())}</span>
          <input
            className="admin-key"
            type="password"
            value={adminKey}
            onChange={(event) => setAdminKey(event.target.value)}
            placeholder="Admin key for actions"
            aria-label="Admin key"
            autoComplete="off"
          />
          <button type="button" className="ghost" onClick={refresh}>
            Refresh
          </button>
        </div>
      </header>

      {notice ? (
        <div className="notice" role="status">
          {notice}
          <button type="button" className="ghost small" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
      {error ? <div className="notice error">Monitor API error: {error}</div> : null}

      <section className="stats" aria-label="Overview">
        <StatCard label="Registered devices" value={summary?.total_registered ?? devices.length} detail={`${registeredOnly} awaiting heartbeat`} />
        <StatCard label="Connected" value={connected} detail="heartbeat fresh" />
        <StatCard label="Offline" value={offline} detail={`expires after ${summary?.offline_after_seconds ?? 90}s`} />
        <StatCard label="Active workers" value={summary?.active_workers ?? 0} detail="compute opted in" />
        <StatCard label="Available RAM" value={formatMb(summary?.total_available_ram_mb)} detail="connected workers" />
        <StatCard label="Active tasks" value={summary?.active_tasks ?? 0} detail={`${summary?.executing ?? 0} executing`} />
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Devices</h2>
          <span className="muted small">POST /api/v1/heartbeat · every 30s</span>
        </div>
        {devices.length ? (
          <div className="device-list">
            {devices.map((device) => (
              <DeviceCard
                key={device.id}
                device={device}
                adminKey={adminKey}
                pending={pending}
                onQueue={queueBenchmark}
                onCancel={cancelTask}
              />
            ))}
          </div>
        ) : (
          <div className="empty-card">
            <h3>No devices registered yet</h3>
            <p className="muted">
              On the phone: <code>primal init --server &lt;this-url&gt;</code> then{' '}
              <code>primal connect</code>.
            </p>
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Tasks</h2>
          <span className="muted small">deterministic hash_sum_v1 workload</span>
        </div>
        <TaskTable tasks={tasks} adminKey={adminKey} pending={pending} onCancel={cancelTask} />
      </section>

      <footer className="footer">
        <span>Primal Space Monitor · Vercel + private Blob state</span>
        <span className="muted">
          API: register · heartbeat · devices · tasks/claim · tasks/result · disconnect
        </span>
      </footer>
    </main>
  );
}
