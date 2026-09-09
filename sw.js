// Service Worker — cache do app shell para instalação e uso offline básico
const CACHE = 'locacoes-dashboard-v2';
const ASSETS = ['./', './index.html', './manifest.json', './icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Deixa passar direto tudo que não é do mesmo domínio (Firebase, CDNs, etc.)
  if (url.origin !== location.origin || e.request.method !== 'GET') return;

  const isHTML = e.request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('/');

  if (isHTML) {
    // Rede primeiro — sempre que abrir com internet, pega a versão mais
    // nova na hora. Só usa o cache se estiver offline.
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Demais arquivos (ícone, manifest): cache primeiro, atualiza em segundo plano
  e.respondWith(
    caches.match(e.request).then(cached => {
      const network = fetch(e.request)
        .then(res => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

// ── Notificações push — avisos de limpeza ─────────────────────────
// Recebe o aviso do dia seguinte (check-in/checkout) mandado pelo
// Apps Script via Firebase Cloud Messaging, mostra como notificação
// nativa, e ao tocar abre o WhatsApp da equipe com a mensagem pronta.
self.addEventListener('push', e => {
  let payload = {};
  try {
    const json = e.data ? e.data.json() : {};
    payload = json.data || json.notification || json;
  } catch (err) {
    payload = { title: 'Dashboard Locações', body: e.data ? e.data.text() : '' };
  }

  const titulo = payload.title || 'Dashboard Locações';
  const opcoes = {
    body: payload.body || '',
    icon: './icon.svg',
    badge: './icon.svg',
    data: { url: payload.url || './' },
  };

  e.waitUntil(self.registration.showNotification(titulo, opcoes));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(self.clients.openWindow(url));
});
