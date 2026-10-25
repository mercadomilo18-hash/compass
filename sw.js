// Offline support: app files are served from cache and refreshed in the background.
const CACHE = 'compass-v3';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png',
  'js/app.js', 'js/store.js', 'js/util.js', 'js/ui.js', 'js/forms.js', 'js/components.js', 'js/planner.js', 'js/bible.js',
  'js/plans.js', 'js/school.js', 'js/finance.js', 'js/connect.js', 'js/ics.js', 'js/ai.js', 'js/notify.js', 'js/scan.js',
  'js/views/today.js', 'js/views/calendar.js', 'js/views/tasks.js', 'js/views/money.js', 'js/views/habits.js', 'js/views/bible.js',
  'js/views/chat.js', 'js/views/settings.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Never cache API calls (Claude, your Compass server, Plaid).
  if (url.hostname === 'api.anthropic.com') return;
  const cdn = url.hostname === 'cdn.jsdelivr.net';
  if (url.origin !== location.origin && !cdn) return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const hit = await cache.match(e.request, { ignoreSearch: !cdn });
    const net = fetch(e.request).then((res) => { if (res.ok) cache.put(e.request, res.clone()); return res; }).catch(() => hit);
    if (cdn) return hit || net; // pinned versions never change
    return hit ? (e.waitUntil(net), hit) : net;
  }));
});

// Pushes from the Compass server carry no data (nothing personal passes through Apple/Google push servers).
self.addEventListener('push', (e) => {
  const evening = new Date().getHours() >= 17;
  e.waitUntil(self.registration.showNotification(evening ? 'Evening recap' : 'Your daily briefing', {
    body: evening ? 'See what got done and what’s next for tomorrow.' : 'Your schedule, deadlines and money for today are ready.',
    icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: evening ? 'recap' : 'briefing', data: { url: './#today' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((list) => {
    const target = new URL(e.notification.data?.url || './', self.registration.scope).href;
    const open = list.find((c) => c.url.startsWith(self.registration.scope));
    return open ? open.focus().then((c) => c.navigate?.(target)) : self.clients.openWindow(target);
  }));
});
