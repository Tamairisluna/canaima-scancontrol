# Suspender y reactivar ScanControl

Este procedimiento conserva usuarios, inventarios, evaluaciones y registros. Solo cambia el estado visible de la aplicación.

## Suspender el acceso

Ejecuta en **Supabase > SQL Editor**:

```sql
update public.app_runtime_settings
set maintenance_enabled = true,
    updated_at = now()
where id = 'scancontrol';
```

Si la tabla todavía no existe, ejecuta primero el archivo `CONFIGURAR_MODO_MANTENIMIENTO.sql`; ese archivo también activa la suspensión y configura los mensajes actuales.

## Reactivar el acceso

Ejecuta únicamente:

```sql
update public.app_runtime_settings
set maintenance_enabled = false,
    updated_at = now()
where id = 'scancontrol';
```

No hace falta volver a desplegar la aplicación. El cambio se refleja cuando el usuario vuelve a abrir ScanControl.

## Comprobar el estado

```sql
select id, maintenance_enabled, updated_at
from public.app_runtime_settings
where id = 'scancontrol';
```

- `true`: acceso suspendido.
- `false`: acceso activo.
