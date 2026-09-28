self.addEventListener('push', event => {
  const payload = event.data ? event.data.json() : {};
  event.waitUntil(self.registration.showNotification(payload.title || 'Crime Map', {
    body: payload.body || '',
    tag: payload.tag || 'crime-map',
    data: { url: payload.url || '/' },
    icon: '/brand/v2/icon-192.png',
    badge: '/brand/v2/badge.png',
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const destination = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
    const existing = windows.find(window => new URL(window.url).origin === self.location.origin);
    return existing ? existing.focus().then(() => existing.navigate(destination)) : clients.openWindow(destination);
  }));
});
