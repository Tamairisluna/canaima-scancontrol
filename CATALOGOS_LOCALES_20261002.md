# Catálogos locales de ScanControl

La importación anterior insertaba productos en Supabase y, al terminar, llamaba a `activate_catalog`, que también eliminaba versiones anteriores en cascada. El usuario informó `canceling statement due to statement timeout` en esa finalización. Sin acceso administrativo a los registros de producción, no se atribuye el error a una sentencia concreta del servidor.

## Cambio

Los Excel nuevos se procesan con el importador existente y se guardan en IndexedDB. Cada proyecto, cuenta y tienda tiene un único catálogo en ese navegador/dispositivo. Un reemplazo completo usa una transacción: se confirma solamente cuando termina la escritura; los errores de formato, cuota o cancelación conservan el catálogo anterior. No se crean versiones ni productos en Supabase y no se llama a las funciones de activación o descarte.

El lector utiliza los productos locales con los mismos precios, descuentos, códigos de barras, tallas y agrupación por artículo/color. Sus productos no tienen un ID de Supabase. Evaluaciones y Registro diario siguen guardando sus datos completos en la nube con `product_id = null`, como permiten los flujos existentes de incidencias sin producto.

Mientras una cuenta/dispositivo no tenga un Excel local para su tienda, se puede seguir consultando su catálogo activo anterior en Supabase. No se eliminan los catálogos existentes ni se modifica SQL, Auth, permisos, traslados o la cámara. Esta publicación evita el crecimiento causado por nuevas importaciones; no libera por sí sola el espacio que ya estaba ocupado.

## Uso

Cargar el Excel en cada dispositivo y cuenta que vaya a escanear. Conservar el archivo original: borrar los datos del navegador, cambiar de equipo o usar otra cuenta exige cargarlo otra vez. La aplicación indica `En este dispositivo` o `Catálogo compartido anterior`. La persistencia del navegador se solicita como mejor esfuerzo; puede ser rechazada o el almacenamiento puede ser borrado por el usuario.

Esta versión permite consultar el catálogo mientras la aplicación está abierta con conexión inestable. No añade apertura de la PWA sin internet ni una cola de sincronización de evaluaciones.

## Verificación

- Compilación de Next.js, TypeScript y ESLint.
- 23 pruebas de reglas existentes y 7 pruebas de IndexedDB: aislamiento, 100.000 productos, reapertura, validación, reemplazo, cuota y cancelación posterior al éxito de `put`.
- Navegador Chromium, escritorio y vista móvil Android, con API interceptada: importación real XLSX, precio y descuento, reapertura, errores de archivo y cuota, evaluación con talla menor no exhibida, snapshots en los payloads de Registro/Evaluación aislamiento entre tiendas y actualización entre ventanas del mismo dispositivo/cuenta.
- Video de prueba controlado para recorrer el flujo existente de cámara; no sustituye pruebas de enfoque en teléfonos físicos. Se verificó que las funciones de cámara/enfoque no cambiaron respecto de producción.

Para pruebas aisladas:

```bash
npm install --prefix /tmp/scancontrol-local-tests --ignore-scripts fake-indexeddb@6.2.4
FAKE_INDEXEDDB_PATH=/tmp/scancontrol-local-tests/node_modules/fake-indexeddb/build/esm/index.js node --test tests/local-catalog.test.mjs
npm install --prefix /tmp/scancontrol-browser-tests --ignore-scripts playwright@1.51.1
# Instalar Chromium mediante el CLI de Playwright y arrancar `npm run start` en 3100.
PLAYWRIGHT_PATH=/tmp/scancontrol-browser-tests/node_modules/playwright/index.mjs node tests/local-catalog-browser.mjs
```

## Respaldo y reversión

Versión productiva anterior: `8f6f23d659575a87bd92578cc8841222ed6d9f1c`.
Rama de respaldo en GitHub: `backup/pre-local-catalogs-20261002`.

Para volver atrás, recuperar/publicar la versión del respaldo o revertir el commit de catálogos locales y dejar que Vercel publique. Los catálogos de Supabase siguen disponibles porque no se borran en esta migración. Los datos locales permanecen en IndexedDB y la versión anterior no los consulta.

Las instancias abiertas no se recargan forzosamente. Para obtener la versión nueva, cerrar y abrir la app; no borrar los datos del sitio.
