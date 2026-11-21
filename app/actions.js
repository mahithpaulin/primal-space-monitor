'use server';

import crypto from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { issueTask, cancelTask } from '../lib/actions.js';

export async function enqueueBenchmarkAction({ deviceId }) {
  try {
    const task = await issueTask({
      deviceId,
      workload: 'hash_sum_v1',
      params: {
        seed: crypto.randomBytes(8).toString('hex'),
        iterations: 200000,
        chunks: 8,
      },
      limits: { max_cpu_pct: 20, max_memory_mb: 128, deadline_seconds: 120 },
      createdBy: 'dashboard',
    });
    revalidatePath('/');
    return {
      ok: true,
      taskId: task.id,
      message: `Benchmark ${task.id.slice(0, 8)} queued for ${task.device_name || 'device'}.`,
    };
  } catch (error) {
    return { ok: false, error: error.message || 'Could not queue task.' };
  }
}

export async function cancelTaskAction({ taskId }) {
  try {
    const task = await cancelTask(taskId);
    revalidatePath('/');
    return { ok: true, message: `Cancel requested for ${task.id.slice(0, 8)}.` };
  } catch (error) {
    return { ok: false, error: error.message || 'Could not cancel task.' };
  }
}
