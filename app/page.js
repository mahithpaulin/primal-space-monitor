import { cookies } from 'next/headers';
import { readState } from '../lib/store.js';
import { deviceView, summarize } from '../lib/status.js';
import { taskView } from '../lib/tasks.js';
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

  return (
    <Dashboard
      initialDevices={devices}
      initialTasks={tasks}
      initialSummary={summarize(state.devices, state.tasks, now)}
    />
  );
}
