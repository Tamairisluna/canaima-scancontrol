-- SQL Editor de canaima-scancontrol, rol postgres.
-- Ejecutar en una consulta nueva, sin otras instrucciones SQL.
-- Elimina por lotes los inventarios antiguos seleccionados que superen la revalidación.
call scancontrol_maintenance.limpiar_sin_uso_20261003(null);
