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
- **Esquema de base de datos diseñado:** `docs/schema.sql` con 16 tablas,
  relaciones, roles (administrador, monitora, jefa de calidad), permisos RLS,
  triggers de protección, Storage para fotos e informes y datos iniciales.
  Explicado en `docs/esquema-supabase.md`.
- **Esquema probado:** ejecutado en PGlite (PostgreSQL en el navegador) con
  `auth` y `storage` simulados. 36 comprobaciones, todas correctas
  (`tests/schema/`).
- **Esquema aplicado en Supabase:** 16 tablas con RLS, funciones y Storage.
  Creado el local "Supermercado Demo" con su catálogo y el primer usuario
  administrador.
- **Acceso con Supabase:** `src/auth.js` con pantalla de entrada (correo y
  contraseña), opción "Seguir sin conexión", sesión recordada, nombre y rol en
  la barra superior y panel "Mi cuenta".

### Pendiente
- Fase 1: permisos por rol en la app y gestión de usuarios desde la interfaz.
- Fase 2: mejoras locales (historial de solo lectura, conformidad de la jefa,
  borrado con respaldo).
- Fase 3: leer y escribir en Supabase (proveedor `supabase-provider.js`),
  guardado por partes y subida de fotos a Storage.
- Trasladar los datos actuales del navegador al local, una sola vez.
- Definir qué ocurre al rechazar una auditoría (si la monitora corrige y
  reenvía).
