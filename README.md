# Canaima ScanControl

Aplicación web móvil de Grupo Canaima para escaneo continuo de productos, consulta de precios por tienda, carga de catálogos Excel y evaluaciones con reportes editables.

## Supabase Auth

La sesión se mantiene en cookies mediante `@supabase/ssr`. El `proxy.ts` valida el JWT antes de servir rutas privadas y renueva la sesión cuando corresponde.

- Públicas: `/login`, `/instalar`, `/auth/callback` y `/sw.js`.
- Protegidas: `/`, `/update-password` y cualquier ruta nueva que no se declare pública.
- Variables: copia `.env.example` a `.env.local` y utiliza únicamente la URL y la clave **publishable**. Nunca expongas una clave `service_role` o `secret`.

Para confirmación de correo y recuperación de contraseña, autoriza en Supabase la URL de producción con la ruta `/auth/callback`.
