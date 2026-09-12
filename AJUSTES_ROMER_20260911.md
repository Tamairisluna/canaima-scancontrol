# Ajustes de Romer pendientes de publicación

Base verificada: main f348205eb9d00f39e053f56423a30ed9b9bd0888.
Respaldo remoto: backup/pre-romer-ajustes-20260911.
La usuaria confirmó que la app y el escáner funcionan correctamente.

## Implementado y probado localmente

- Evaluación: controles compactos Precio erróneo, Mal etiquetado y Sin etiqueta encima del visor ampliado. Sin cambios en las funciones de cámara, búsqueda, foco o registro.
- Productos evaluados: solo muestra incidencias. Todos los registros permanecen en memoria/base y siguen formando parte de los contadores.
- Word editable: resumen completo, detalle solo de incidencias, cabeceras repetidas, precio y firmas Responsable 1, Responsable 2 y Supervisor del área.
- Catálogo se llama Inventario en navegación, título y panel activo.
- Por empleado incluye la tienda. Agrupa por identificador de empleado y tienda para no mezclar homónimos o varias sucursales.
- Lint y build pasan. 18 pruebas automáticas pasan. Informe de una página y de tres páginas generado y revisado visualmente.

No se ha probado la interfaz interna en navegador autenticado ni en teléfonos físicos. No se ha publicado en producción.

## Confirmaciones de la usuaria

- Traslados activos es un Excel independiente POR TIENDA, con columna Articulo. Debe permitir cargar, reemplazar y eliminar. Tras identificar el producto por Código barras, compara el artículo con los traslados de esa tienda y muestra aviso, sin afectar el lector.
- Puerto la Cruz y Puerto Ordaz tendrán usuarios máster DIFERENTES. Falta definir el correo de Puerto Ordaz. Su contraseña se establecerá manualmente; nunca incluir contraseñas del Excel en código o documentación.
- EE MILLENNIUM 2025, C.A. y BB MILLENNIUM 2024, C.A. son DOS tiendas independientes.
- El Excel contiene 83 filas; separar Millennium da 84 empresas en 10 ciudades. Usuarios máster separados darán 10 cuentas.
- Registro público: escoger Ciudad primero, luego tienda de esa ciudad. Rol inicial siempre employee.
- Nuevos máster: supervisores limitados a las empresas que les corresponden. Romer y cuentas existentes conservan permisos. No convertir supervisores existentes en regionales automáticamente.

## Pendientes

1. La usuaria ejecutará REVISION_SUPABASE_TIENDAS.sql (solo lectura) en la base realmente conectada a Vercel y enviará el resultado. El conector Supabase disponible no corresponde a esta app. No usar otros proyectos.
2. Con ese esquema real, preparar cambios manuales para ciudades/empresas, ámbitos de supervisores nuevos y traslados. No ejecutar modificaciones directamente en Supabase.
3. Conservar IDs de tiendas existentes y sus catálogos/usuarios; comparar nombres normalizados sin duplicar por puntuación. No eliminar tiendas ausentes en el nuevo Excel sin confirmación (JJ PF 2026 no figura en el archivo nuevo).
4. Implementar los controles y carga de traslados reutilizando las protecciones Android de selección de archivos. Carga atómica por tienda, lista previa conservada si falla y comprobación de permisos en servidor.
5. Verificar interfaz móvil/escritorio y nueva autorización; publicar en el proyecto Vercel existente cuando todo esté preparado.

Producción e instalación permanecen en https://canaima-scancontrol.vercel.app/ y /instalar. No crear otro Site ni usar chatgpt.site. No tocar login, lector, PWA ni Excel de inventario durante estos ajustes.
