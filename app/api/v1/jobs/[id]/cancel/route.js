import { cancelJob } from '../../../../../../lib/actions.js';
import { adminGateResponse, isAdminRequest } from '../../../../../../lib/admin.js';
import { cleanString, json, fail } from '../../../../../../lib/http.js';

export const dynamic = 'force-dynamic';

export async function POST(request, { params }) {
  if (!isAdminRequest(request)) {
    const gate = adminGateResponse();
    return fail(gate.error, gate.status);
  }
  const jobId = cleanString(params?.id, 64);
  if (!jobId) return fail('job_id_required', 400);
  try {
    const job = await cancelJob(jobId);
    return json({ ok: true, job });
  } catch (error) {
    return fail(error.message || 'cancel_failed', 400);
  }
}
