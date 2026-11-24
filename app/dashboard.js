'use client';

import { useEffect, useState, useTransition } from 'react';
import {
  enqueueTaskAction,
  cancelTaskAction,
  enqueueJobAction,
  cancelJobAction,
  sendMessageAction,
  setLendingAction,
  transferCreditsAction,
} from './actions.js';

const STATUS_LABELS = {
  registered: 'Registered',
  connected: 'Connected',
  executing: 'Executing task',
  offline: 'Offline',
};

const WORKLOAD_LABELS = {
  python: 'Python function',
  shell: 'Shell command',
  http: 'HTTP request',
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

function preview(value, limit = 160) {
  if (value === null || value === undefined) return '—';
  let text;
  try {
    text = JSON.stringify(value);
  } catch {
    text = String(value);
  }
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
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

function DeviceCard({ device, pending, onCancel, onTarget }) {
  const metrics = device.metrics || {};
  const worker = device.worker || {};
  const ramTotal = metrics.ram_total_mb;
  const ramAvailable = metrics.ram_available_mb;
  const ramUsed =
    ramTotal !== null && ramTotal !== undefined && ramAvailable !== null && ramAvailable !== undefined
      ? Math.max(0, ramTotal - ramAvailable)
      : null;
  const ramPct = ramTotal ? Math.min(100, Math.max(0, (ramUsed / ramTotal) * 100)) : 0;
  const canTarget = ['connected', 'executing'].includes(device.status);

  return (
    <article className="device-card">
      <div className="device-head">
        <div>
          <h3>
            {device.profile?.avatar ? <span className="avatar">{device.profile.avatar}</span> : null}
            {device.name}
          </h3>
          <p className="muted">
            {[device.manufacturer, device.model].filter(Boolean).join(' ') || 'Unknown device'}
          </p>
        </div>
        <StatusPill status={device.status} />
      </div>

      <dl className="device-grid">
        <div>
          <dt>Platform</dt>
          <dd>
            {device.cli_version || device.android_version
              ? device.cli_version || `Android ${device.android_version}`
              : '—'}
            {device.profile?.status ? <span className="muted"> · {device.profile.status}</span> : null}
          </dd>
        </div>
        <div>
          <dt>CPU</dt>
          <dd>
            {device.cpu_arch || '—'} · {device.cpu_cores ?? '—'} cores ·{' '}
            {metrics.cpu_usage_pct !== null && metrics.cpu_usage_pct !== undefined
              ? `${formatPct(metrics.cpu_usage_pct)} used`
              : `load ${formatPct(metrics.cpu_load_pct)}`}
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
          <dt>Battery</dt>
          <dd>
            {formatPct(metrics.battery_pct)}
            {metrics.charging === true ? ' · charging' : metrics.charging === false ? ' · discharging' : ''}
          </dd>
        </div>
        <div>
          <dt>Workloads</dt>
          <dd>{(device.workloads || []).join(', ') || '—'}</dd>
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
          </dd>
        </div>
      </dl>

      <div className="ram-bar" aria-label="RAM utilization">
        <span style={{ width: `${ramPct}%` }} />
      </div>

      <div className="device-actions">
        <button type="button" className="ghost" disabled={!canTarget} onClick={() => onTarget(device.id)}>
          Message device
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
          {device.status === 'offline' ? 'Offline · waiting for heartbeat' : 'Compute requires local opt-in'}
        </span>
      </div>
    </article>
  );
}

function TaskTable({ tasks, pending, onCancel }) {
  if (!tasks.length) {
    return <p className="muted empty">No standalone tasks yet. Launch one above; any eligible worker can claim it.</p>;
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
            <th>Duration</th>
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
              <td>{WORKLOAD_LABELS[task.workload] || task.workload}</td>
              <td>{task.device_name || shortId(task.device_id)}</td>
              <td>
                <span className={`task-status task-${task.status}`}>{task.status}</span>
              </td>
              <td>{task.duration_ms !== null && task.duration_ms !== undefined ? `${(task.duration_ms / 1000).toFixed(2)}s` : '—'}</td>
              <td className="mono" title={preview(task.result_value, 2000)}>{preview(task.result_value)}</td>
              <td className="mono output-cell" title={task.stdout || ''}>{task.stdout || '—'}</td>
              <td className="muted">{formatTime(task.created_at)}</td>
              <td>
                {['pending', 'claimed', 'executing'].includes(task.status) ? (
                  <button type="button" className="ghost small" disabled={pending} onClick={() => onCancel(task.id)}>
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
  const summary = job.summary || {};
  return (
    <article className="job-card">
      <div className="job-head">
        <div>
          <h3>{WORKLOAD_LABELS[job.workload] || job.workload} job</h3>
          <p className="muted small">
            {shortId(job.id)} · {job.shard_count} shard{job.shard_count === 1 ? '' : 's'}
            {job.item_count ? ` · ${job.item_count} items` : ''} · reduce {job.reduce} · {formatAge(job.created_at)}
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
      {summary.command ? <p className="mono small muted">$ {summary.command}</p> : null}
      {summary.url ? <p className="mono small muted">{summary.method} {summary.url}</p> : null}
      <div className="progress" aria-label={`${pct}% complete`}>
        <div className="progress-bar" style={{ width: `${pct}%` }} />
      </div>
      <div className="job-meta">
        <span className="muted small">
          {progress.completed}/{progress.total} shards done
          {progress.executing || progress.claimed ? ` · ${progress.executing + progress.claimed} running` : ''}
          {progress.failed ? ` · ${progress.failed} failed` : ''}
        </span>
        <span className="muted small" title={preview(job.aggregate?.value ?? job.aggregate?.partial_value, 2000)}>
          {job.aggregate && (job.aggregate.value !== null || job.aggregate.partial_value !== null)
            ? `result ${preview(job.aggregate.value ?? job.aggregate.partial_value, 80)}`
            : 'aggregating…'}
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

function LendingPanel({ devices, pending, onToggle }) {
  if (!devices.length) return <p className="muted empty">No devices to lend from yet.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Device</th>
            <th>Active compute</th>
            <th>CPU offered</th>
            <th>Per hour</th>
            <th>Units/hour</th>
            <th>Units banked</th>
            <th>Units earned</th>
            <th>Used this hour</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {devices.map((device) => {
            const lending = device.lending || {};
            const credits = device.credits || {};
            return (
              <tr key={device.id}>
                <td>{device.name}</td>
                <td>
                  <span className={`pill status-${lending.enabled ? 'connected' : 'offline'}`}>
                    <span className="dot" />
                    {lending.enabled ? 'Lending' : 'Idle'}
                  </span>
                </td>
                <td>{lending.cpu_pct ?? 20}%</td>
                <td>{lending.minutes_per_hour ?? 30} min</td>
                <td>{lending.units_per_hour ?? 1}</td>
                <td className="mono">{credits.units ?? 0}</td>
                <td className="mono">{credits.total_units ?? 0}</td>
                <td className="mono">{(credits.minutes_used ?? 0).toFixed(1)} min</td>
                <td>
                  <button
                    type="button"
                    className="ghost small"
                    disabled={pending}
                    onClick={() => onToggle(device.id, !lending.enabled)}
                  >
                    {lending.enabled ? 'Stop lending' : 'Start lending'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CurrencyPanel({ devices, summary, transfers, pending, onTransfer }) {
  const wallets = devices.map((device) => ({
    id: device.id,
    name: device.name,
    avatar: device.profile?.avatar || '',
    status: device.profile?.status || '',
    balance: device.wallet?.balance ?? 0,
    earned: device.wallet?.earned_total ?? 0,
    spent: device.wallet?.spent_total ?? 0,
    caps: device.caps || {},
  }));
  const [from, setFrom] = useState(wallets[0]?.id || '');
  const [to, setTo] = useState(wallets[1]?.id || '');
  const [amount, setAmount] = useState('1');
  const [note, setNote] = useState('');

  const capText = (caps) => {
    const parts = [];
    if (caps.day_minutes) parts.push(`${caps.day_used}/${caps.day_minutes}m day`);
    if (caps.week_minutes) parts.push(`${caps.week_used}/${caps.week_minutes}m week`);
    if (caps.month_minutes) parts.push(`${caps.month_used}/${caps.month_minutes}m month`);
    return parts.join(' · ') || 'no caps';
  };

  return (
    <div className="currency-grid">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Wallet</th>
              <th>Balance</th>
              <th>Earned</th>
              <th>Sent</th>
              <th>Compute caps</th>
            </tr>
          </thead>
          <tbody>
            {wallets.map((wallet) => (
              <tr key={wallet.id}>
                <td>
                  <span className="wallet-name">
                    {wallet.avatar ? <span className="avatar">{wallet.avatar}</span> : null}
                    {wallet.name}
                  </span>
                  {wallet.status ? <span className="muted small block">{wallet.status}</span> : null}
                </td>
                <td className="mono">{wallet.balance.toFixed(3)} CU</td>
                <td className="mono">{wallet.earned.toFixed(3)}</td>
                <td className="mono">{wallet.spent.toFixed(3)}</td>
                <td className="muted small">{capText(wallet.caps)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="currency-side">
        <div className="stat-row">
          <StatCard label="Total balance" value={`${(summary?.total_balance ?? 0).toFixed(3)} CU`} detail="spendable across devices" />
          <StatCard label="Minted" value={`${(summary?.total_earned ?? 0).toFixed(3)} CU`} detail="earned by lending" />
          <StatCard label="Transferred" value={`${(summary?.total_transferred ?? 0).toFixed(3)} CU`} detail={`${summary?.transfer_count ?? 0} transfers`} />
        </div>

        <div className="compose">
          <select className="task-input" value={from} onChange={(event) => setFrom(event.target.value)} aria-label="From wallet">
            {wallets.map((wallet) => (
              <option key={wallet.id} value={wallet.id}>{wallet.name}</option>
            ))}
          </select>
          <select className="task-input" value={to} onChange={(event) => setTo(event.target.value)} aria-label="To wallet">
            {wallets.map((wallet) => (
              <option key={wallet.id} value={wallet.id}>{wallet.name}</option>
            ))}
          </select>
          <input
            className="task-input task-input-small"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            aria-label="Amount"
            inputMode="decimal"
          />
          <input
            className="task-input"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="note"
            aria-label="Transfer note"
          />
          <button
            type="button"
            className="primary"
            disabled={pending || !from || !to || from === to}
            onClick={() => onTransfer({ from, to, amount: Number(amount), note })}
          >
            Send CU
          </button>
        </div>

        {transfers.length ? (
          <ul className="message-list">
            {transfers.slice(0, 8).map((transfer) => (
              <li key={transfer.id} className="message">
                <div className="message-head">
                  <span className="mono small">
                    {transfer.from_name || transfer.from} → {transfer.to_name || transfer.to}: {transfer.amount} CU
                  </span>
                  <span className="muted small">{formatAge(transfer.created_at)}</span>
                </div>
                {transfer.note ? <p className="message-body">{transfer.note}</p> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted empty">No transfers yet. Compute units are currency — move them between devices.</p>
        )}
      </div>
    </div>
  );
}

function MessageFeed({ messages, devices }) {
  if (!messages.length) return <p className="muted empty">No messages yet. Say hello to a device.</p>;
  const name = (id) => {
    if (!id) return 'all devices';
    if (id === 'operator') return 'Operator';
    return devices.find((device) => device.id === id)?.name || shortId(id);
  };
  return (
    <ul className="message-list">
      {messages.map((message) => (
        <li key={message.id} className="message">
          <div className="message-head">
            <span className="mono small">{name(message.from)} → {name(message.to)}</span>
            <span className="muted small">{formatAge(message.created_at)}</span>
          </div>
          <p className="message-body">{message.body}</p>
        </li>
      ))}
    </ul>
  );
}

export default function Dashboard({ initialDevices, initialTasks, initialJobs = [], initialMessages = [], initialSummary, initialCurrency }) {
  const [devices, setDevices] = useState(initialDevices);
  const [tasks, setTasks] = useState(initialTasks);
  const [jobs, setJobs] = useState(initialJobs);
  const [messages, setMessages] = useState(initialMessages);
  const [currency, setCurrency] = useState(initialCurrency || { summary: {}, transfers: [] });
  const [summary, setSummary] = useState(initialSummary);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);

  const [workload, setWorkload] = useState('python');
  const [target, setTarget] = useState('any');
  const [shards, setShards] = useState(4);
  const [reduce, setReduce] = useState('concat');
  const [code, setCode] = useState('def main(items):\n    return items');
  const [command, setCommand] = useState('echo "$PRIMAL_ITEMS"');
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('https://api.github.com/repos/mahithpaulin/primalspace-android');
  const [items, setItems] = useState('');

  const [composeTo, setComposeTo] = useState('');
  const [composeBody, setComposeBody] = useState('');

  const [lastUpdated, setLastUpdated] = useState(Date.now());
  const [pending, startTransition] = useTransition();

  async function refresh() {
    try {
      const [devicesResponse, tasksResponse, jobsResponse, messagesResponse, creditsResponse] = await Promise.all([
        fetch('/api/v1/devices', { cache: 'no-store' }),
        fetch('/api/v1/tasks?limit=20', { cache: 'no-store' }),
        fetch('/api/v1/jobs?limit=12', { cache: 'no-store' }),
        fetch('/api/v1/messages?limit=30', { cache: 'no-store' }),
        fetch('/api/v1/credits?limit=30', { cache: 'no-store' }),
      ]);
      if (!devicesResponse.ok || !tasksResponse.ok) throw new Error('Monitor API unavailable');
      const devicesPayload = await devicesResponse.json();
      const tasksPayload = await tasksResponse.json();
      const jobsPayload = jobsResponse.ok ? await jobsResponse.json() : { jobs: [] };
      const messagesPayload = messagesResponse.ok ? await messagesResponse.json() : { messages: [] };
      const currencyPayload = creditsResponse.ok ? await creditsResponse.json() : { summary: {}, transfers: [] };
      setDevices(devicesPayload.devices || []);
      setSummary(devicesPayload.summary || {});
      setTasks(tasksPayload.tasks || []);
      setJobs(jobsPayload.jobs || []);
      setMessages(messagesPayload.messages || []);
      setCurrency(currencyPayload);
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

  function friendlyError(error) {
    const text = error || 'Request failed.';
    if (text.includes('items_required_for_sharding')) {
      return 'Add a JSON items array to split this job across shards.';
    }
    if (text.includes('insufficient_balance')) return 'That wallet does not have enough CU.';
    if (text.includes('unsupported_workload')) return 'No eligible device supports that workload.';
    return text;
  }

  function buildParams() {
    let parsedItems;
    if (items.trim()) {
      try {
        parsedItems = JSON.parse(items);
      } catch {
        return { error: 'Items must be valid JSON.' };
      }
      if (!Array.isArray(parsedItems)) return { error: 'Items must be a JSON array.' };
    }
    if (workload === 'python') {
      return { params: { code, ...(parsedItems ? { items: parsedItems } : {}) } };
    }
    if (workload === 'shell') {
      return { params: { command, ...(parsedItems ? { items: parsedItems } : {}) } };
    }
    return { params: { method, url } };
  }

  function runTask() {
    const built = buildParams();
    if (built.error) {
      setNotice(built.error);
      return;
    }
    startTransition(async () => {
      const result =
        target === 'distributed'
          ? await enqueueJobAction({ workload, params: built.params, shards: Number(shards) || 1, reduce })
          : await enqueueTaskAction({
              workload,
              params: built.params,
              deviceId: target === 'any' ? null : target,
            });
      setNotice(result.ok ? result.message : result.error);
      if (result.ok) refresh();
    });
  }

  function toggleLending(deviceId, enabled) {
    startTransition(async () => {
      const result = await setLendingAction({ deviceId, enabled });
      setNotice(result.ok ? result.message : friendlyError(result.error));
      if (result.ok) refresh();
    });
  }

  function sendTransfer({ from, to, amount, note }) {
    if (!Number.isFinite(amount) || amount <= 0) {
      setNotice('Enter a transfer amount greater than zero.');
      return;
    }
    startTransition(async () => {
      const result = await transferCreditsAction({ from, to, amount, note });
      setNotice(result.ok ? result.message : result.error);
      if (result.ok) refresh();
    });
  }

  function sendMessage() {
    if (!composeBody.trim()) {
      setNotice('Message body is empty.');
      return;
    }
    startTransition(async () => {
      const result = await sendMessageAction({ to: composeTo || null, body: composeBody });
      setNotice(result.ok ? result.message : result.error);
      if (result.ok) {
        setComposeBody('');
        refresh();
      }
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
          <p className="muted">Operator console · arbitrary tasks across your devices</p>
        </div>
        <div className="topbar-right">
          <span className={`live ${error ? 'live-error' : ''}`}>
            <span className="dot" />
            {error ? 'API error' : 'live'}
          </span>
          <span className="muted small">updated {formatAge(new Date(lastUpdated).toISOString())}</span>
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
        <StatCard label="Compute units" value={summary?.total_compute_units ?? 0} detail={`${summary?.lending_devices ?? 0} devices lending`} />
        <StatCard label="CU balance" value={`${(currency.summary?.total_balance ?? 0).toFixed(2)}`} detail="spendable currency" />
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Launch a task</h2>
          <span className="muted small">run on one device, any device, or split into parallel shards</span>
        </div>
        <div className="task-form">
          <label className="muted small" htmlFor="task-workload">Workload</label>
          <select
            id="task-workload"
            className="task-input"
            value={workload}
            onChange={(event) => {
              const next = event.target.value;
              setWorkload(next);
              if (next === 'http' && target === 'distributed') setTarget('any');
            }}
          >
            <option value="python">Python function</option>
            <option value="shell">Shell command</option>
            <option value="http">HTTP request</option>
          </select>

          <label className="muted small" htmlFor="task-target">Target</label>
          <select
            id="task-target"
            className="task-input"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          >
            <option value="any">Any eligible device</option>
            {workload === 'http' ? null : <option value="distributed">Distribute across devices</option>}
            {devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name} ({device.status})
              </option>
            ))}
          </select>

          {target === 'distributed' ? (
            <>
              <label className="muted small" htmlFor="task-shards">Shards</label>
              <input
                id="task-shards"
                className="task-input task-input-small"
                type="number"
                min="1"
                max="64"
                value={shards}
                onChange={(event) => setShards(event.target.value)}
              />
              <label className="muted small" htmlFor="task-reduce">Reduce</label>
              <select
                id="task-reduce"
                className="task-input"
                value={reduce}
                onChange={(event) => setReduce(event.target.value)}
              >
                <option value="concat">concat (merge lists)</option>
                <option value="sum">sum (numbers)</option>
                <option value="count">count (items)</option>
                <option value="first">first shard</option>
                <option value="sum:field">sum of one field (e.g. sum:total)</option>
              </select>
            </>
          ) : null}

          {workload === 'python' ? (
            <textarea
              className="python-code task-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              spellCheck={false}
              aria-label="Python code"
            />
          ) : null}
          {workload === 'shell' ? (
            <input
              className="task-input task-wide"
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              aria-label="Shell command"
            />
          ) : null}
          {workload === 'http' ? (
            <>
              <select className="task-input" value={method} onChange={(event) => setMethod(event.target.value)} aria-label="HTTP method">
                {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
              <input
                className="task-input task-wide"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                aria-label="URL"
              />
            </>
          ) : null}

          {workload === 'http' ? null : (
            <input
              className="task-input task-wide"
              value={items}
              onChange={(event) => setItems(event.target.value)}
              placeholder='Items JSON array (optional, e.g. ["a","b","c"])'
              aria-label="Items JSON"
            />
          )}

          <button type="button" className="primary" disabled={pending} onClick={runTask}>
            {target === 'distributed' ? 'Run distributed job' : 'Run task'}
          </button>
        </div>
        <p className="muted small">
          Python: define <code>main(items)</code> and return JSON. Shell: <code>$PRIMAL_ITEMS</code> holds the shard slice. HTTP: devices fetch the URL.
        </p>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Jobs</h2>
          <span className="muted small">one job → many shards, auto-scheduled to every capable worker</span>
        </div>
        {jobs.length ? (
          <div className="job-list">
            {jobs.map((job) => (
              <JobCard key={job.id} job={job} pending={pending} onCancel={cancelJob} />
            ))}
          </div>
        ) : (
          <p className="muted empty">No jobs yet. Add items and choose “Distribute across devices”.</p>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Devices</h2>
          <span className="muted small">capabilities are advertised in each heartbeat</span>
        </div>
        {devices.length ? (
          <div className="device-list">
            {devices.map((device) => (
              <DeviceCard
                key={device.id}
                device={device}
                pending={pending}
                onCancel={cancelTask}
                onTarget={(deviceId) => {
                  setComposeTo(deviceId);
                  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
                }}
              />
            ))}
          </div>
        ) : (
          <div className="empty-card">
            <h3>No devices registered yet</h3>
            <p className="muted">
              On the phone: <code>primal init --server &lt;this-url&gt;</code> then <code>primal connect</code>.
            </p>
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Currency</h2>
          <span className="muted small">compute units are spendable credits · move them peer to peer</span>
        </div>
        <CurrencyPanel
          devices={devices}
          summary={currency.summary}
          transfers={currency.transfers || []}
          pending={pending}
          onTransfer={sendTransfer}
        />
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Compute lending</h2>
          <span className="muted small">active compute · one unit per hour of compute lent</span>
        </div>
        <LendingPanel devices={devices} pending={pending} onToggle={toggleLending} />
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Messages</h2>
          <span className="muted small">device ↔ device and operator ↔ device</span>
        </div>
        <div className="compose">
          <select className="task-input" value={composeTo} onChange={(event) => setComposeTo(event.target.value)} aria-label="Message target">
            <option value="">All devices</option>
            {devices.map((device) => (
              <option key={device.id} value={device.id}>{device.name}</option>
            ))}
          </select>
          <input
            className="task-input task-wide"
            value={composeBody}
            onChange={(event) => setComposeBody(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') sendMessage();
            }}
            placeholder="Message body"
            aria-label="Message body"
          />
          <button type="button" className="primary" disabled={pending} onClick={sendMessage}>
            Send
          </button>
        </div>
        <MessageFeed messages={messages} devices={devices} />
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Standalone tasks</h2>
          <span className="muted small">python · shell · http</span>
        </div>
        <TaskTable tasks={tasks.filter((task) => !task.job_id)} pending={pending} onCancel={cancelTask} />
      </section>

      <footer className="footer">
        <span>Primal Space Monitor · Vercel + Neon state</span>
        <span className="muted">
          API: register · heartbeat · devices · tasks · jobs · messages · peers
        </span>
      </footer>
    </main>
  );
}
