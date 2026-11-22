import { readState } from '../../../../lib/store.js';
import { issueJob } from '../../../../lib/actions.js';
import { jobView } from '../../../../lib/jobs.js';
import { sweepStore } from '../../../../lib/scheduler.js';
import { adminGateResponse, isAdminRequest } from '../../../../lib/admin.js';
import { cleanString, json, fail, readJson } from '../../../../lib/http.js';
import { WORKLOADS } from '../../../../lib/tasks.js';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  if (!isAdminRequest(request)) {
    const gate = adminGateResponse();
    return fail(gate.error, gate.status);
  }
  await sweepStore();
  const state = await readState();
  const url = new URL(request.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 20));
  const jobs = Object.values(state.jobs || {})
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, limit)
    .map((job) => jobView(job, state.tasks, state.devices));
  return json({ jobs });
}

export async function POST(request) {
  if (!isAdminRequest(request)) {
    const gate = adminGateResponse();
    return fail(gate.error, gate.status);
  }
  const body = await readJson(request);
  if (!body) return fail('invalid_json', 400);
  const workload = cleanString(body.workload, 32) || 'hash_sum_v1';
  if (!WORKLOADS.includes(workload)) return fail('unsupported_workload', 400);
  try {
    const job = await issueJob({
      workload,
      params: body.params || {},
      shards: body.shards,
      limits: body.resource_limits || {},
      createdBy: 'operator_api',
    });
    return json({ job }, 201);
  } catch (error) {
    return fail(error.message || 'job_create_failed', 400);
  }
}
