'use client';

import { useEffect, useState, useTransition } from 'react';
import {
  enqueueBenchmarkAction,
  enqueuePythonAction,
  cancelTaskAction,
  enqueueJobAction,
  cancelJobAction,
} from './actions.js';

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

function DeviceCard({ device, pending, onQueue, onCancel }) {
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
            {metrics.cpu_usage_pct !== null && metrics.cpu_usage_pct !== undefined
              ? `${formatPct(metrics.cpu_usage_pct)} used`
              : `load ${formatPct(metrics.cpu_load_pct)} (util unavailable)`}
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

function TaskTable({ tasks, pending, onCancel }) {
  if (!tasks.length) {
    return           <p className="muted empty">No tasks yet. Use Queue task above; any eligible worker can claim it.</p>;
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Task</th>
            <th>Workload</th>
            <th>Device</th>
            <th>Status</th>
            <th>Verified</th>
            <th>Duration</th>
            <th>Worker CPU</th>
            <th>RSS peak</th>
            <th>Result</th>
            <th>Output</th>
            <th>Created</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.id}>
              <td className="mono">{shortId(task.id)}</td>
              <td>{task.workload}</td>
              <td>{task.device_name || shortId(task.device_id)}</td>
              <td>
                <span className={`task-status task-${task.status}`}>{task.status}</span>
              </td>
              <td>
                {task.verified === true ? 'yes' : task.verified === false ? 'no' : '—'}
              </td>
              <td>{task.duration_ms !== null && task.duration_ms !== undefined ? `${(task.duration_ms / 1000).toFixed(2)}s` : '—'}</td>
              <td>{task.metrics?.worker_cpu_pct_avg !== null && task.metrics?.worker_cpu_pct_avg !== undefined ? `${task.metrics.worker_cpu_pct_avg}%` : '—'}</td>
              <td>{task.metrics?.rss_mb_peak !== null && task.metrics?.rss_mb_peak !== undefined ? `${task.metrics.rss_mb_peak} MB` : '—'}</td>
              <td className="mono">{task.result_value === null || task.result_value === undefined ? '—' : JSON.stringify(task.result_value)}</td>
              <td className="mono output-cell" title={task.stdout || ''}>{task.stdout || '—'}</td>
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


const JOB_STATUS = {
  pending: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelling: 'Cancelling',
  cancelled: 'Cancelled',
};

const SHARD_COLORS = {
  pending: 'var(--muted)',
  claimed: 'var(--warn)',
  executing: 'var(--exec)',
  completed: 'var(--good)',
  failed: 'var(--bad)',
  cancelled: 'var(--muted)',
};

function JobCard({ job, pending, onCancel }) {
  const progress = job.progress || { total: 0, completed: 0, failed: 0 };
  const total = Math.max(1, progress.total);
  const done = progress.completed + progress.failed + progress.cancelled;
  const pct = Math.round((done / total) * 100);
  const active = ['pending', 'running', 'cancelling'].includes(job.status);
  return (
    <article className="job-card">
      <div className="job-head">
        <div>
          <h3>{job.workload === 'python_func' ? 'Python job' : 'Distributed hash job'}</h3>
          <p className="muted small">
            {shortId(job.id)} · {job.shard_count} shard{job.shard_count === 1 ? '' : 's'}
            {job.total_iterations ? ` · ${job.total_iterations.toLocaleString()} iterations` : ''} ·{' '}
            {formatAge(job.created_at)}
          </p>
        </div>
        <div className="job-actions">
          <span className={`pill status-${job.status === 'completed' ? 'connected' : job.status === 'failed' ? 'offline' : 'executing'}`}>
            <span className="dot" />
            {JOB_STATUS[job.status] || job.status}
          </span>
          {active ? (
            <button type="button" className="ghost small" disabled={pending} onClick={() => onCancel(job.id)}>
              Cancel
            </button>
          ) : null}
        </div>
      </div>
      <div className="progress" aria-label={`${pct}% complete`}>
        <div className="progress-bar" style={{ width: `${pct}%` }} />
      </div>
      <div className="job-meta">
        <span className="muted small">
          {progress.completed}/{progress.total} shards done
          {progress.executing || progress.claimed ? ` · ${progress.executing + progress.claimed} running` : ''}
          {progress.failed ? ` · ${progress.failed} failed` : ''}
        </span>
        <span className="muted small">
          {job.aggregate && job.aggregate.value !== null ? `result ${job.aggregate.value}` : 'aggregating…'}
          {job.aggregate && job.aggregate.verified === true ? ' · verified' : ''}
        </span>
      </div>
      <div className="shard-grid">
        {job.shards.map((shard) => (
          <span
            key={shard.id}
            className="shard-chip"
            style={{ borderColor: SHARD_COLORS[shard.status] || 'var(--border)', color: SHARD_COLORS[shard.status] || 'var(--muted)' }}
            title={`shard ${shard.index} · ${shard.status}${shard.device_name ? ` · ${shard.device_name}` : ''}${shard.attempts ? ` · attempts ${shard.attempts}` : ''}`}
          >
            {shard.index + 1}
          </span>
        ))}
      </div>
    </article>
  );
}

export default function Dashboard({ initialDevices, initialTasks, initialJobs = [], initialSummary }) {
  const [devices, setDevices] = useState(initialDevices);
  const [tasks, setTasks] = useState(initialTasks);
  const [jobs, setJobs] = useState(initialJobs);
  const [jobIterations, setJobIterations] = useState(600000);
  const [jobShards, setJobShards] = useState(12);
  const [summary, setSummary] = useState(initialSummary);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const [iterations, setIterations] = useState(200000);
  const [chunks, setChunks] = useState(8);
  const [pythonCode, setPythonCode] = useState('def main(args):\n    print(args)\n    return {"ok": True, "args": args}');
  const [pythonArgs, setPythonArgs] = useState('{"message":"hello"}');
  const [pythonSeconds, setPythonSeconds] = useState(10);
  const [lastUpdated, setLastUpdated] = useState(Date.now());
  const [pending, startTransition] = useTransition();

  async function refresh() {
    try {
      const [devicesResponse, tasksResponse, jobsResponse] = await Promise.all([
        fetch('/api/v1/devices', { cache: 'no-store' }),
        fetch('/api/v1/tasks?limit=20', { cache: 'no-store' }),
        fetch('/api/v1/jobs?limit=12', { cache: 'no-store' }),
      ]);
      if (!devicesResponse.ok || !tasksResponse.ok) throw new Error('Monitor API unavailable');
      const devicesPayload = await devicesResponse.json();
      const tasksPayload = await tasksResponse.json();
      const jobsPayload = jobsResponse.ok ? await jobsResponse.json() : { jobs: [] };
      setDevices(devicesPayload.devices || []);
      setSummary(devicesPayload.summary || {});
      setTasks(tasksPayload.tasks || []);
      setJobs(jobsPayload.jobs || []);
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

  function queueBenchmark(deviceId = null) {
    startTransition(async () => {
      const result = await enqueueBenchmarkAction({ deviceId, iterations, chunks });
      setNotice(result.ok ? result.message : result.error);
      if (result.ok) refresh();
    });
  }

  function runPython(deviceId = null) {
    startTransition(async () => {
      let args;
      try {
        args = JSON.parse(pythonArgs || 'null');
      } catch {
        setNotice('Python args must be valid JSON.');
        return;
      }
      const result = await enqueuePythonAction({
        deviceId,
        code: pythonCode,
        args,
        maxSeconds: pythonSeconds,
      });
      setNotice(result.ok ? result.message : result.error);
      if (result.ok) refresh();
    });
  }

  function runJob() {
    startTransition(async () => {
      const result = await enqueueJobAction({
        workload: 'hash_sum_v1',
        params: { iterations: Number(jobIterations) || 600000, chunks: 8 },
        shards: Number(jobShards) || 12,
      });
      setNotice(result.ok ? result.message : result.error);
      if (result.ok) refresh();
    });
  }

  function cancelJob(jobId) {
    startTransition(async () => {
      const result = await cancelJobAction({ jobId });
      setNotice(result.ok ? result.message : result.error);
      if (result.ok) refresh();
    });
  }

  function cancelTask(taskId) {
    startTransition(async () => {
      const result = await cancelTaskAction({ taskId });
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
            className="task-input"
            type="number"
            min="1"
            max="500000"
            value={iterations}
            onChange={(event) => setIterations(event.target.value)}
            aria-label="Iterations"
            title="Iterations"
          />
          <input
            className="task-input task-input-small"
            type="number"
            min="1"
            max="64"
            value={chunks}
            onChange={(event) => setChunks(event.target.value)}
            aria-label="Chunks"
            title="Chunks"
          />
          <button type="button" className="primary" disabled={pending} onClick={() => queueBenchmark()}>
            Queue task
          </button>
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
          <span className="muted small">Public queue · eligible workers claim automatically</span>
        </div>
        {devices.length ? (
          <div className="device-list">
            {devices.map((device) => (
              <DeviceCard
                key={device.id}
                device={device}
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
          <h2>Distributed jobs</h2>
          <span className="muted small">one job → many parallel shards, auto-scheduled to every capable worker</span>
        </div>
        <div className="job-form">
          <label className="muted small" htmlFor="job-iterations">Total iterations</label>
          <input
            id="job-iterations"
            className="task-input"
            type="number"
            min="1000"
            max="2000000"
            step="1000"
            value={jobIterations}
            onChange={(event) => setJobIterations(event.target.value)}
          />
          <label className="muted small" htmlFor="job-shards">Shards</label>
          <input
            id="job-shards"
            className="task-input task-input-small"
            type="number"
            min="1"
            max="64"
            value={jobShards}
            onChange={(event) => setJobShards(event.target.value)}
          />
          <button type="button" className="primary" disabled={pending} onClick={runJob}>
            Run distributed job
          </button>
        </div>
        {jobs.length ? (
          <div className="job-list">
            {jobs.map((job) => (
              <JobCard key={job.id} job={job} pending={pending} onCancel={cancelJob} />
            ))}
          </div>
        ) : (
          <p className="muted empty">No jobs yet. One job splits into shards that any eligible device can claim in parallel.</p>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Python console</h2>
          <span className="muted small">restricted python_func workload</span>
        </div>
        <div className="python-panel">
          <textarea
            className="python-code"
            value={pythonCode}
            onChange={(event) => setPythonCode(event.target.value)}
            spellCheck={false}
            aria-label="Python code"
          />
          <div className="python-controls">
            <input className="task-input" value={pythonArgs} onChange={(event) => setPythonArgs(event.target.value)} aria-label="Python args JSON" />
            <input className="task-input task-input-small" type="number" min="1" max="30" value={pythonSeconds} onChange={(event) => setPythonSeconds(event.target.value)} aria-label="Python timeout seconds" />
            <button type="button" className="primary" disabled={pending} onClick={() => runPython()}>Run on any device</button>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Tasks</h2>
          <span className="muted small">hash_sum_v1 and restricted python_func workloads</span>
        </div>
        <TaskTable tasks={tasks.filter((task) => !task.job_id)} pending={pending} onCancel={cancelTask} />
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
