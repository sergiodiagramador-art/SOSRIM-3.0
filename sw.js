const CACHE_NAME = 'sosrim-v3.1'; // Mudei a versão para forçar atualização
const ASSETS = [
  './',
  './index.html',
  './manifest.json'
];

// Instalação e Cache inicial
self.addEventListener('install', (e) => {
  self.skipWaiting(); // Força o novo service worker a tomar o controle imediatamente
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

// Ativação e Limpeza de caches antigos
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
});

// Estratégia Network First (Tenta internet, se falhar usa cache)
self.addEventListener('fetch', (e) => {
  e.respondWith(
    fetch(e.request).catch(() => {
      return caches.match(e.request);
    })
  );
});
