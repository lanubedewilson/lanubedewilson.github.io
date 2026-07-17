/* =============================================================
   SERVICE WORKER — La Nube de Wilson
   Estrategia:
   - App shell (HTML/CSS/JS propio + imágenes/fuentes estáticas):
     Cache-First → se entrega desde caché al instante y, si no
     estaba, se guarda una copia para la próxima vez.
   - Datos dinámicos (Google Sheets, ESPN, GNews, radios, etc.):
     NO se cachean acá — eso lo maneja el propio JS de la página
     con localStorage (stale-while-revalidate), porque son datos
     que cambian todo el tiempo y el usuario necesita la versión
     más nueva posible, no una vieja servida por el SW.
   ============================================================= */

const CACHE_VERSION = 'lnw-shell-v1';
const APP_SHELL = [
  './',
  './index.html',
  './LNW.png',
  './trionda.png'
];

/* Dominios que consideramos "estructurales" (fuentes, íconos, video de fondo)
   y que sí queremos servir cache-first una vez descargados una vez. */
const STATIC_CACHEABLE = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdnjs.cloudflare.com'
];

/* Dominios de datos dinámicos que el SW nunca debe interceptar/cachear */
const NETWORK_ONLY = [
  'docs.google.com',
  'site.api.espn.com',
  'news.google.com',
  'api.whatsapp.com',
  'googletagmanager.com',
  'google-analytics.com'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)).catch(() => {
      /* si algún asset del shell no existe (ej. se renombró un ícono), no rompemos la instalación */
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

function isNetworkOnly(url) {
  return NETWORK_ONLY.some((domain) => url.hostname.includes(domain));
}

function isStaticCacheable(url) {
  return STATIC_CACHEABLE.some((domain) => url.hostname.includes(domain));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 1) Datos dinámicos: siempre red, nunca caché del SW.
  if (isNetworkOnly(url)) {
    return; // deja que el navegador maneje la petición normalmente
  }

  // 2) Mismo origen (el propio sitio: HTML, imágenes, mp4) o CDNs estáticos
  //    permitidos → estrategia Cache-First.
  const sameOrigin = url.origin === self.location.origin;
  if (sameOrigin || isStaticCacheable(url)) {
    event.respondWith(cacheFirst(req));
  }
});

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) {
    // Revalida en segundo plano sin bloquear la respuesta (mantiene el shell fresco)
    fetchAndUpdateCache(req);
    return cached;
  }
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) {
      const cache = await caches.open(CACHE_VERSION);
      cache.put(req, fresh.clone());
    }
    return fresh;
  } catch (e) {
    // Sin red y sin caché: si pedían el HTML principal, devolvemos el shell cacheado como último recurso
    const fallback = await caches.match('./index.html');
    if (fallback) return fallback;
    throw e;
  }
}

async function fetchAndUpdateCache(req) {
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) {
      const cache = await caches.open(CACHE_VERSION);
      cache.put(req, fresh.clone());
    }
  } catch (e) {
    /* offline: nos quedamos con lo que ya había en caché */
  }
}
