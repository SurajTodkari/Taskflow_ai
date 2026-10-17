import type { QueryClient } from '@tanstack/react-query';
import { API_URL, tokenStore } from './api';

let sock: WebSocket | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let attempts = 0;
let stopped = true;

function wsUrl(): string {
  const base = API_URL || window.location.origin;
  return base.replace(/^http/, 'ws') + `/ws?token=${encodeURIComponent(tokenStore.access || '')}`;
}

export function startRealtime(qc: QueryClient) {
  stopped = false;
  const connect = () => {
    if (stopped || !tokenStore.access) return;
    try {
      sock = new WebSocket(wsUrl());
    } catch { schedule(); return; }
    sock.onopen = () => { attempts = 0; };
    sock.onmessage = () => { qc.invalidateQueries(); };
    sock.onclose = () => { sock = null; schedule(); };
    sock.onerror = () => { sock?.close(); };
  };
  const schedule = () => {
    if (stopped) return;
    attempts += 1;
    const delay = Math.min(30000, 1000 * 2 ** Math.min(attempts, 5));
    timer = setTimeout(connect, delay);
  };
  connect();
}

export function stopRealtime() {
  stopped = true;
  if (timer) clearTimeout(timer);
  timer = null;
  sock?.close();
  sock = null;
}
