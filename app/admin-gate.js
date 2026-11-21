'use client';

import { useState, useTransition } from 'react';
import { adminLoginAction } from './actions.js';

export default function AdminGate() {
  const [key, setKey] = useState('');
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  function submit(event) {
    event.preventDefault();
    startTransition(async () => {
      const result = await adminLoginAction(key);
      if (result.ok) window.location.reload();
      else setError(result.error || 'Access denied.');
    });
  }

  return (
    <main className="gate-shell">
      <form className="gate-card" onSubmit={submit}>
        <div className="brand">
          <span className="brand-mark" />
          PRIMAL SPACE
        </div>
        <h1>Operator access</h1>
        <p className="muted">This console is private. Enter the operator key to continue.</p>
        <input
          className="gate-input"
          type="password"
          value={key}
          onChange={(event) => setKey(event.target.value)}
          placeholder="Operator key"
          aria-label="Operator key"
          autoFocus
        />
        <button type="submit" className="primary" disabled={pending || key.length === 0}>
          {pending ? 'Checking…' : 'Unlock console'}
        </button>
        {error ? <div className="notice error">{error}</div> : null}
      </form>
    </main>
  );
}
