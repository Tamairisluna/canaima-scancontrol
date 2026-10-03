-- Ejecutar sola en una consulta nueva de SQL Editor, rol postgres.
-- Mantenimiento normal: reutilización de espacio y estadísticas de productos.
-- TRUNCATE FALSE evita el bloqueo exclusivo para truncar páginas finales.
-- SKIP_LOCKED omite la tabla si hay un bloqueo inicial conflictivo.
-- No borra datos vivos ni requiere suspender la aplicación.
VACUUM (ANALYZE, TRUNCATE FALSE, SKIP_LOCKED, PARALLEL 0) public.products;
