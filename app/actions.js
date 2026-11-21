'use server';

import crypto from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { issueTask, cancelTask } from '../lib/actions.js';

export async function enqueueBenchmarkAction({ deviceId = null, iterations = 200000, chunks = 8 }) {
  try {
    const task = await issueTask({
      deviceId: deviceId || null,
      workload: 'hash_sum_v1',
      params: {
        seed: crypto.randomBytes(8).toString('hex'),
        iterations: Number(iterations),
        chunks: Number(chunks),
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

export async function enqueuePythonAction({ deviceId = null, code = '', args = null, maxSeconds = 10 }) {
  try {
    const task = await issueTask({
      deviceId: deviceId || null,
      workload: 'python_func',
      params: { code, args },
      limits: { max_cpu_pct: 20, max_memory_mb: 128, deadline_seconds: 60, max_seconds: Number(maxSeconds) },
      createdBy: 'dashboard',
    });
    revalidatePath('/');
    return {
      ok: true,
      taskId: task.id,
      message: `Python task ${task.id.slice(0, 8)} queued for ${task.device_name || 'device'}.`,
    };
  } catch (error) {
    return { ok: false, error: error.message || 'Could not queue Python task.' };
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
