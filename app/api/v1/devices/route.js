import { readState } from '../../../../lib/store.js';
import { deviceView, summarize } from '../../../../lib/status.js';
import { json } from '../../../../lib/http.js';

export const dynamic = 'force-dynamic';

export async function GET() {
  const state = await readState();
  const now = Date.now();
  return json({
    summary: summarize(state.devices, state.tasks, now),
    devices: Object.values(state.devices)
      .map((device) => deviceView(device, now))
      .sort((a, b) => a.name.localeCompare(b.name)),
  });
}
