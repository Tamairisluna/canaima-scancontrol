export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET() {
  const deploymentVersion =
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.VERCEL_URL ??
    process.env.npm_package_version ??
    "development";

  const source = `
const APP_VERSION = ${JSON.stringify(deploymentVersion)};
const CACHE_PREFIX = "canaima-scancontrol-";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith(CACHE_PREFIX))
        .map((name) => caches.delete(name)),
    );
    await self.clients.claim();

    // Una activación equivale a una publicación nueva. La navegación obliga
    // a las apps ya instaladas a tomar el HTML y los bundles actuales.
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    await Promise.all(windows.map(async (client) => {
      client.postMessage({ type: "SCANCONTROL_UPDATED", version: APP_VERSION });
      try {
        await client.navigate(client.url);
      } catch {
        // controllerchange en el cliente conserva el respaldo de recarga.
      }
    }));
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.mode !== "navigate") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Nunca reutilizar el HTML anterior: los recursos de Next.js llevan hash y
  // se descargan automáticamente cuando el documento nuevo los referencia.
  event.respondWith(fetch(request, { cache: "no-store" }));
});
`;

  return new Response(source, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
      "CDN-Cache-Control": "no-store",
      "Vercel-CDN-Cache-Control": "no-store",
      "Service-Worker-Allowed": "/",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
