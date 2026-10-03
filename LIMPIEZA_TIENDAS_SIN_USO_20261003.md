# Limpieza manual de los inventarios sin uso

La lectura entregada el 3 de octubre de 2026 confirmó la eliminación del lote anterior: 166 versiones y 749 productos, con cero pendientes en ese lote. La base informaba `472 MB` mediante `pg_size_pretty`. La nueva selección contiene únicamente estas diez tiendas, con 18 versiones y 189.966 filas de productos:

| Tienda | Filas revisadas |
| --- | ---: |
| CC CANDELARIA 2022, C.A. | 57.628 |
| BB CHACAITO CCS 2025, C.A. | 30.869 |
| CC LEC 2022, C.A. | 22.045 |
| BB VLP 2024, C.A | 19.858 |
| BB APU 2022, C.A | 19.334 |
| BB LIDER 2022, C.A. | 18.632 |
| DD SCI 2024, C.A | 8.297 |
| FF CCS 2024, C.A. | 5.816 |
| EE CANDELARIA 2025, C.A. | 5.804 |
| DD CCS 2023, C.A. | 1.683 |

Los inventarios de otras tiendas quedan fuera. Esta selección incluye los antiguos `active` y `ready` de las tiendas sin uso, conforme a la solicitud de retirarlos y volver a cargar Excel cuando esas tiendas necesiten la app. La tienda permanece activa; sus usuarios, asignaciones, escaneos, evaluaciones e incidencias permanecen. La relación opcional `evaluation_items.product_id` queda en NULL al borrar el producto; los demás campos de su registro histórico permanecen.

## Ejecución en canaima-scancontrol

1. En SQL Editor, con rol **postgres**, ejecutar completo `LIMPIAR_TIENDAS_SIN_USO_20261003.sql`. Instala la cola privada y un índice pequeño sobre `evaluation_items.product_id`. No elimina inventarios. Debe devolver `limpieza_instalada=true`, `maximo_productos_revisados=189966`, `tiendas_del_listado=10`.
2. Abrir una consulta nueva, también con rol postgres, y ejecutar únicamente:

```sql
call scancontrol_maintenance.limpiar_sin_uso_20261003(null);
```

La llamada confirma lotes de hasta 5.000 productos. Se limita a 50 lotes y comprueba un presupuesto de 40 segundos entre operaciones; una operación individual puede durar más. Guarda el progreso al confirmar cada lote. Si hay un timeout, volver a ejecutar la misma llamada retoma los lotes confirmados. No combinar la llamada con `BEGIN`, `SET`, otras consultas ni impersonar otro rol: PostgreSQL exige que una llamada que confirma transacciones se ejecute desde el nivel superior. El código actual de SQL Editor desactiva el envoltorio transaccional para consultas manuales; otros clientes pueden envolverlas.

Si `productos_pendientes` o `tiendas_pendientes_revision` sigue por encima de cero, revisar `detalle`: un bloqueo temporal permite reintentar; una versión reactivada o conteos cambiados requieren revisión antes de insistir. El resultado acumula los conteos iniciales y eliminados, muestra los conteos finales por tienda, las tiendas protegidas y el tamaño físico actual. Exportar el resultado a CSV para comprobarlo.

## Protecciones

Antes de retirar cada inventario, bloquea su tienda y revalida escaneos, evaluaciones, accesos/cuentas nuevas de empleados o gerentes, publicaciones recientes y versiones `uploading`. Cualquier registro en `store_catalog_files` protege todo el inventario de la tienda. El corte se fija al 26 de septiembre de 2026, 03:36 UTC, o a siete días antes de la ejecución si es anterior; una llamada futura no puede expirar inventarios que hayan tenido actividad después de esta revisión. Un nombre o conteo inesperado también impide la retirada.

Registra los identificadores exactos de las versiones retiradas, pone su puntero activo en NULL y las archiva en una sola transacción. Después elimina filas únicamente de esas versiones, con bloqueos de filas y `SKIP LOCKED`/`NOWAIT`. Un catálogo nuevo publicado durante la limpieza tiene otro identificador y queda intacto. Una versión antigua reactivada detiene los lotes de esa tienda. Los inventarios retirados pueden dejar de aparecer en los dispositivos que consultan Supabase; las copias locales completas pueden permanecer hasta que se cargue el Excel actualizado.

La cola y el procedimiento usan un esquema privado, RLS y privilegios revocados a `PUBLIC`, `anon` y `authenticated`. El procedimiento es `SECURITY INVOKER`. No añade tareas programadas, modifica la app ni toca archivos en Storage. No cambia los permisos de las tiendas. Verifica las dependencias y triggers de productos/versiones antes de comenzar; una dependencia no revisada impide ejecutar la limpieza.

## Espacio físico

Eliminar las filas no garantiza que el contador de tamaño baje enseguida: PostgreSQL conserva páginas liberadas para reutilizarlas. Ese espacio pertenece a la relación que lo libera y no equivale automáticamente a margen disponible para otras tablas. Esta limpieza no ejecuta `VACUUM FULL`, que requiere un bloqueo exclusivo y espacio adicional. La eventual compactación física debe evaluarse por separado cuando se confirme que no hay usuarios activos. No se calcula el margen de la cuota de Supabase restando directamente `472 MB` de `500 MB`: las unidades y la medición del panel pueden diferir.

Las cargas nuevas ya usan un archivo comprimido por tienda en Storage y una fila de metadatos, sin añadir cientos de miles de productos a Postgres. La app elimina el archivo sustituido mediante Storage API después de confirmar la publicación y reintenta temporales abandonados en cargas posteriores. Esta limpieza retira únicamente los restos del sistema anterior.

## Validación y fuentes

`tests/unused-store-cleanup.test.mjs` ejecuta el SQL exacto en PostgreSQL aislado (PGlite): alcance por UUID, actividad reciente, historiales, roles, cambios de conteos/dependencias, reanudación entre commits, reactivación y conservación de una publicación nueva. También prueba el volumen revisado de 189.966 filas. La ejecución en producción y sus conteos finales deben confirmarse mediante el resultado del panel; el conector administrativo disponible no tiene acceso a este proyecto.

- PostgreSQL: https://www.postgresql.org/docs/current/plpgsql-transactions.html
- VACUUM: https://www.postgresql.org/docs/current/sql-vacuum.html
- SQL Editor, `buildExecuteParams`, `isStatementTimeoutDisabled: true` (consultado el 3 de octubre de 2026): https://github.com/supabase/supabase/blob/master/apps/studio/components/interfaces/SQLEditor/SQLEditor.utils.ts
- Ejecución/timeout de pg-meta (consultado el 3 de octubre de 2026): https://github.com/supabase/postgres-meta/blob/master/src/lib/db.ts

Fuente de conteos: CSV entregado por el usuario, `Supabase Snippet Untitled query (7).csv`, apartados `01_lote_archivado`, `02_uso_por_tienda`, `03_base_actual`. Los scripts se guardan en una rama de limpieza; no requieren publicar cambios de aplicación en Vercel.

## Resultado confirmado en producción

El usuario ejecutó la instalación y la llamada desde SQL Editor. La captura `image(20261003-043414).png`, entregada el 3 de octubre de 2026 a las 00:34 de Santo Domingo, confirma:

| Comprobación | Resultado |
| --- | ---: |
| Productos antes | 189.966 |
| Productos eliminados | 189.966 |
| Tiendas completas | 10 |
| Tiendas protegidas | 0 |
| Tiendas pendientes | 0 |
| Productos pendientes en las versiones retiradas | 0 |
| Catálogos pendientes en las versiones retiradas | 0 |
| Tamaño físico informado | 452 MB |

La eliminación seleccionada está completa. El tamaño informado bajó de 472 MB a 452 MB; la lectura no identifica qué mantenimiento interno produjo la reducción. No se ha ejecutado `VACUUM FULL`.

Como mantenimiento posterior, `PASO_3_MANTENIMIENTO_NORMAL_20261003.sql` contiene una sola instrucción VACUUM normal sobre `public.products`, con ANALYZE, sin truncado exclusivo y sin esperar un bloqueo inicial conflictivo. Se ejecuta sola en una consulta nueva. Deja reutilizable espacio dentro de esa tabla y actualiza estadísticas; no garantiza que el tamaño físico baje más. Su ejecución y resultado aún están pendientes de confirmación del usuario.
