import { cookies } from 'next/headers';
import { readState } from '../lib/store.js';
import { deviceView, summarize } from '../lib/status.js';
import { taskView } from '../lib/tasks.js';
import { jobView } from '../lib/jobs.js';
import { listAll } from '../lib/messages.js';
import { groupView } from '../lib/groups.js';
import { currencySummary, listTransfers } from '../lib/credits.js';
import { ADMIN_COOKIE, adminKey, safeEqual } from '../lib/admin.js';
import AdminGate from './admin-gate.js';
import Dashboard from './dashboard.js';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const expected = adminKey();
  if (expected) {
    const store = await cookies();
    const provided = store.get(ADMIN_COOKIE)?.value ?? null;
    if (!provided || !safeEqual(provided, expected)) {
      return <AdminGate />;
    }
  }

  const state = await readState();
  const now = Date.now();
  const devices = Object.values(state.devices)
    .map((device) => deviceView(device, now))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const tasks = Object.values(state.tasks)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, 50)
    .map((task) => taskView(task, state.devices));

  const jobs = Object.values(state.jobs || {})
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, 30)
    .map((job) => jobView(job, state.tasks, state.devices));

  const messages = listAll(state, 30);
  const groups = Object.values(state.groups || {})
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .map((group) => groupView(state, group));
  const currency = { summary: currencySummary(state, state.devices), transfers: listTransfers(state, 30) };

  return (
    <Dashboard
      initialDevices={devices}
      initialTasks={tasks}
      initialJobs={jobs}
      initialMessages={messages}
      initialGroups={groups}
      initialCurrency={currency}
      initialSummary={summarize(state.devices, state.tasks, now)}
    />
  );
}
