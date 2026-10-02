# ScanControl: una carga de Excel por tienda

El empleado autorizado carga el Excel en Inventario. Se procesa con las mismas reglas de códigos, precios, descuentos y tallas, se convierte en un archivo compacto comprimido y se publica en el bucket privado `scancontrol-catalogs`. Supabase guarda una fila de metadatos por tienda en `store_catalog_files`; no se insertan productos ni versiones en las tablas anteriores.

Los teléfonos de los usuarios autorizados descargan el archivo de la tienda seleccionada y guardan una copia en IndexedDB. Comprueban la versión al abrir/seleccionar tienda, volver a la app, recuperar conexión y cada 60 segundos mientras la app está visible. Una versión ya guardada no se descarga de nuevo. No hace falta enviar el Excel a todos los empleados.

La copia anterior sigue disponible mientras se descarga la nueva. Antes de reemplazarla se comprueban checksum SHA-256, tamaño, tienda, versión, filas y productos. Una descarga fallida conserva la última copia completa. Las validaciones de talla pendientes se completan antes de cambiar el catálogo. Si falta espacio local, se permite escanear los productos actuales en memoria y se muestra el aviso de persistencia.

## Activación sin suspender el servicio

1. Publicar el código probado en Vercel.
2. Ejecutar `ACTIVAR_CATALOGOS_COMPARTIDOS_20261002.sql` en SQL Editor del proyecto **canaima-scancontrol**. El bloque es aditivo, idempotente y debe devolver tres valores `true`. Crea tabla, bucket privado, permisos y función de publicación. No borra datos existentes ni cambia el mantenimiento.
3. Abrir/actualizar la app. Una persona por tienda carga su Excel actualizado una vez. Los demás dispositivos recuperan esa versión automáticamente con conexión. Los dispositivos con una versión antigua de la app deben aceptar su actualización habitual.
4. Comprobar la misma prenda desde un segundo teléfono sin seleccionar ningún archivo y comparar precio, descuento y talla.

Hasta activar el SQL y publicar el primer archivo de cada tienda, siguen disponibles los catálogos locales anteriores y los inventarios históricos activos de Supabase. El código reconoce cuando la tabla nueva aún no existe y mantiene la lectura anterior. Una nueva carga compartida muestra un aviso de activación pendiente en ese caso.

La publicación se confirma después de subir el archivo completo. Dos cargas simultáneas de la misma tienda usan comparación de versión y bloqueo breve por tienda; la segunda debe reintentarse si la primera ya cambió la versión. La función usa `SECURITY INVOKER`, RLS y el permiso existente `current_user_can_access_store`, manteniendo las asignaciones de cada rol. El archivo actual no puede borrarse mediante la política de limpieza. El archivo sustituido se elimina vía Storage API después de publicar; los temporales abandonados mayores de una hora se limpian en cargas posteriores. Un fallo de limpieza no invalida la carga publicada.

## Espacio y descargas

La tarifa oficial consultada el 2 de octubre de 2026 incluye, en Free, 500 MB de base de datos, 1 GB de archivos, 5 GB de egress y 5 GB de cached egress. El almacenamiento de archivos se contabiliza aparte; las descargas siguen sujetas a cuotas. Fuente: https://supabase.com/pricing

La caché evita descargar en cada escaneo o reapertura si la versión sigue igual. Cada actualización diaria sí se descarga una vez en cada teléfono que utilice esa tienda. El consumo mensual depende del tamaño real comprimido, las actualizaciones y los dispositivos. No se garantiza capacidad ilimitada.

Prueba sintética: 30.000 productos con campos repetitivos ocuparon 85.699 bytes comprimidos, frente a 5.910.001 bytes de JSON de prueba. Esta medida comprueba el codec; no estima el tamaño real de los Excel del cliente.

Consulta de espacio real después de activar y cargar archivos:

```sql
select count(*) as tiendas_con_catalogo,
       pg_size_pretty(coalesce(sum(compressed_bytes),0)::bigint) as archivos_actuales,
       pg_size_pretty(pg_total_relation_size('public.store_catalog_files')) as tabla_de_metadatos
from public.store_catalog_files;

select count(*) as archivos_en_storage,
       pg_size_pretty(coalesce(sum((metadata->>'size')::bigint),0)::bigint) as espacio_en_storage
from storage.objects where bucket_id = 'scancontrol-catalogs';
```

No se borran los catálogos históricos de Postgres en este cambio. Una limpieza posterior podrá liberar ese espacio después de comprobar que cada tienda dispone de su catálogo compartido.

## Respaldo y verificación

Respaldo remoto: `backup/pre-shared-catalogs-20261002`, commit `e6807ab8933d80d540ea788194733410965260d5`. Para volver al flujo por dispositivo, publicar ese commit. La tabla y el bucket aditivos pueden permanecer; no hace falta borrar datos para restaurar el código.

La cámara y el decodificador conservan sus siete funciones/configuraciones sin modificaciones. Las evaluaciones, incidencias, registro diario, permisos y traslados conservan sus flujos.

Pruebas: reglas de negocio e IndexedDB; codec y sincronización de archivos; publicación fallida/ambigua; SQL exacto con RLS en PostgreSQL aislado; dos contextos de navegador independientes, copia local reutilizada, reemplazo diario, descarga corrupta y flujo de cámara/evaluación/registro. El acceso administrativo conectado a Supabase no tiene permiso para este proyecto: la ejecución y comprobación final del SQL en producción deben realizarse desde su panel.
