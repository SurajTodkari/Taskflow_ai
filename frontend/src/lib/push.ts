import { api } from './api';

const VAPID = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export type PushState = 'unsupported' | 'denied' | 'default' | 'granted' | 'subscribed';

function b64ToUint8(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export async function registerSW(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try { return await navigator.serviceWorker.register('/sw.js'); } catch { return null; }
}

export async function getPushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) return 'subscribed';
  return Notification.permission === 'granted' ? 'granted' : 'default';
}

/** Requests permission and subscribes. Returns the resulting state; never throws on denial. */
export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'default';
  const reg = (await registerSW()) || (await navigator.serviceWorker.ready);
  await navigator.serviceWorker.ready;
  let key = VAPID;
  if (!key) {
    try { key = (await api.get<{ public_key?: string; key?: string; publicKey?: string }>('/api/push/public-key')).public_key; } catch { /* ignore */ }
  }
  if (!key) return 'granted';
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(key) as BufferSource });
  const j = sub.toJSON();
  await api.post('/api/push/subscribe', { endpoint: j.endpoint, keys: j.keys });
  return 'subscribed';
}

export async function disablePush(): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    try { await api.post('/api/push/unsubscribe', { endpoint: sub.endpoint }); } catch { /* ignore */ }
    await sub.unsubscribe();
  }
  return getPushState();
}
