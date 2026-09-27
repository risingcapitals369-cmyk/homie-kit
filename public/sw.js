// Pushes arrive with no payload; we fetch the latest text so the notification shows it.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    let title = 'New message', body = 'you got a text';
    try {
      const res = await fetch('/api/latest', { credentials: 'include' });
      if (res.ok) { const d = await res.json(); title = d.name || title; body = d.text || body; }
    } catch {}
    await self.registration.showNotification(title, { body, icon: '/icon-192.png', badge: '/icon-192.png', tag: 'homie', renotify: true });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.length) return wins[0].focus();
    return self.clients.openWindow('/');
  })());
});
