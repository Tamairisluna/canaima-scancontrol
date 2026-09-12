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
- Traslados activos: documento independiente por tienda, carga/reemplazo atómico y eliminación con confirmación. Parser exclusivo Articulo, identificadores como texto, ceros preservados. Aviso visual tras identificar por Código barras; consulta fuera del ciclo del lector.
- Registro: Ciudad → Tienda filtrada. RPC nueva registration_stores_by_city; la función anterior se conserva para versiones instaladas. Alta sigue enviando solo full_name/store_id y el servidor sigue asignando employee.
- Lint y build pasan. 21 pruebas automáticas pasan. Informe de una página y de tres páginas generado y revisado visualmente.
- ACTIVAR_CIUDADES_TRASLADOS.sql probado con PostgreSQL aislado (PGlite 0.5.8): repetición idempotente, perfiles e IDs preservados, permisos por tienda para empleado/gerente, acceso global previo para supervisor/propietario, anonimato denegado en traslados, reemplazo inválido conserva lista anterior, eliminación aislada.
- Comparación exacta contra main: funciones de cámara/foco y bloque lookupProduct → registro/validación/escáner/importExcel sin cambios. El efecto de selección de inventario solo se pausa mientras se procesa un traslado para evitar interferencia entre selectores.

No se ha probado la interfaz interna en navegador autenticado ni en teléfonos físicos. No se ha publicado en producción.

## Confirmaciones de la usuaria

- Traslados activos es un Excel independiente POR TIENDA, con columna Articulo. Debe permitir cargar, reemplazar y eliminar. Tras identificar el producto por Código barras, compara el artículo con los traslados de esa tienda y muestra aviso, sin afectar el lector.
- Puerto la Cruz y Puerto Ordaz tendrán usuarios máster DIFERENTES. Falta definir el correo de Puerto Ordaz. Su contraseña se establecerá manualmente; nunca incluir contraseñas del Excel en código o documentación.
- EE MILLENNIUM 2025, C.A. y BB MILLENNIUM 2024, C.A. son DOS tiendas independientes.
- El Excel contiene 83 filas; separar Millennium da 84 empresas en 10 ciudades. Usuarios máster separados darán 10 cuentas.
- Registro público: escoger Ciudad primero, luego tienda de esa ciudad. Rol inicial siempre employee.
- Nuevos máster: supervisores limitados a las empresas que les corresponden. Romer y cuentas existentes conservan permisos. No convertir supervisores existentes en regionales automáticamente.

## Pendientes

1. CSV de revisión RECIBIDO el 12-sep: 16 tiendas, 46 perfiles (29 empleados, 12 gerentes, 5 supervisores), 10 políticas, 9 funciones. Los supervisores actuales tienen acceso global. No se incluyen correos individuales: no permite confirmar cuentas máster existentes. El conector Supabase disponible no corresponde a esta app. No usar otros proyectos.
2. La usuaria debe ejecutar ACTIVAR_CIUDADES_TRASLADOS.sql manualmente. NO ejecutado en producción por el agente. Añade city, 69 tiendas nuevas y tabla protegida active_transfer_files; conserva los 16 UUID previos, inventarios y perfiles. Resultado esperado con el CSV actual: 85 tiendas activas, 84 con ciudad, 46 cuentas, RLS true. JJ PF 2026 permanece activa bajo Otras tiendas hasta confirmar ciudad; no eliminar ni duplicar.
3. La usuaria autorizó dejar pendientes los correos máster. El Excel trae 9 correos distintos para 10 ciudades; repite Puerto la Cruz para Puerto Ordaz. No inventar otra identidad, no crear automáticamente cuentas globales ni incluir contraseñas en código. La provisión y autorización regional de NUEVOS máster sigue pendiente. Cuentas actuales intactas.
4. Tras confirmación manual de SQL, verificar interfaz móvil/escritorio y flujos reales de registro/traslados. No se ha verificado en dispositivos físicos ni navegador autenticado.
5. Publicar en el proyecto Vercel existente después de esa verificación. No publicar frontend que depende de RPC/tabla antes de activar SQL.

Producción e instalación permanecen en https://canaima-scancontrol.vercel.app/ y /instalar. No crear otro Site ni usar chatgpt.site. No tocar login, lector, PWA ni Excel de inventario durante estos ajustes.
