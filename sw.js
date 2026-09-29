const CACHE_NAME = 'milhas-app-v1';
const TAILWIND_CDN = 'https://cdn.tailwindcss.com';
const LOCAL_ASSETS = ['./', './index.html', './app.js', './manifest.json', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(LOCAL_ASSETS);
      // no-cors: resposta opaca serve para <script>. cache.add rejeita opacas, então fetch + put.
      // Falha do CDN não bloqueia a instalação.
      try {
        const request = new Request(TAILWIND_CDN, { mode: 'no-cors' });
        await cache.put(request, await fetch(request));
      } catch (_) {}
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Stale-while-revalidate para o shell do app. O promocoes.json fica fora do SW:
// o app.js já o busca na rede e guarda o resultado no localStorage.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isShell = url.origin === self.location.origin || request.url.startsWith(TAILWIND_CDN);
  if (!isShell || url.pathname.endsWith('/promocoes.json')) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: true });
      const network = fetch(request)
        .then((response) => {
          if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
