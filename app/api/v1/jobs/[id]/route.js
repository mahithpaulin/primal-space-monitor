import { readState } from '../../../../../lib/store.js';
import { jobView } from '../../../../../lib/jobs.js';
import { sweepStore } from '../../../../../lib/scheduler.js';
import { adminGateResponse, isAdminRequest } from '../../../../../lib/admin.js';
import { cleanString, json, fail } from '../../../../../lib/http.js';

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  if (!isAdminRequest(request)) {
    const gate = adminGateResponse();
    return fail(gate.error, gate.status);
  }
  const jobId = cleanString(params?.id, 64);
  if (!jobId) return fail('job_id_required', 400);
  await sweepStore();
  const state = await readState();
  const job = state.jobs?.[jobId];
  if (!job) return fail('job_not_found', 404);
  return json({ job: jobView(job, state.tasks, state.devices) });
}
