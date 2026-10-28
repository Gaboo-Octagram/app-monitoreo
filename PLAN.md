# Plan de trabajo — Sistema de Calidad (piloto)

Actualizado: 28-10-2026. Estado actual: versión 2 funcionando, con datos guardados solo en el navegador. Las decisiones de abajo están confirmadas.

(Ver plan completo en conversación original. Copiado desde el mensaje del usuario.)

## Avance

### Hecho
- **Fase 0 — Estructura del proyecto:** carpetas `src/`, `tests/`, `docs/`, README,
  `.gitignore`, repositorio git y tag `v2.0`.
- **Cliente Supabase conectado** (`src/supabaseClient.js`, fuera del repo) con CDN
  principal y de respaldo. Verificado: `auth.getSession()` responde sin errores.
- **Capa de datos separada:** `src/data/provider.js` (fachada `AppData`) y
  `src/data/local-storage-provider.js`. `app.js` ya no toca `localStorage`
  directamente y todas sus operaciones son asíncronas (`await`).

### Pendiente
- Fase 1: tablas en Supabase, login y roles (permisos en la base de datos / RLS).
- Fase 2: mejoras locales (historial de solo lectura, conformidad de la jefa,
  borrado con respaldo).
- Fase 3: proveedor `supabase-provider.js` conectado a `AppData`.
- Diseño de `docs/schema.sql` con tablas, relaciones y políticas RLS.
