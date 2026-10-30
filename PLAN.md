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
- **Lectura desde Supabase:** `src/data/supabase-read.js` lee áreas, checks,
  parámetros, trabajadores y auditorías del local, y los cuenta en
  "Mi cuenta → Datos en la nube". Solo lee: la app sigue guardando en el
  navegador.
- **Código dividido en módulos:** `src/lib/` (utilidades, constantes, fotos),
  `src/data/model.js` (estructura y migración de datos) y `src/features/`
  (informe y CSV). `app.js` quedó con el estado, las vistas y los eventos.
- **Datos más livianos:** los borradores se escriben agrupados cada 400 ms (y
  al guardar, cambiar de pantalla o cerrar la pestaña), para no reescribir
  varios MB en cada clic. Aviso "Guardado" y contador de espacio usado.
- **Mejoras de interfaz:** foco visible al usar teclado, diálogos que atrapan
  el foco y lo devuelven al cerrar, Escape cierra, toasts animados (respetando
  "reducir movimiento"), barra de guardar fija en el teléfono y búsqueda del
  historial con pausa al escribir.
- **Exportar CSV:** botón en Historial que descarga las auditorías filtradas
  con separador `;`, tildes correctas y comillas escapadas.
- **Primer guardado en la nube:** `src/data/supabase-write.js` sube la
  auditoría guardada (como borrador), con sus áreas, checks, ausencias y fotos
  a Storage. El navegador sigue siendo la copia principal: si no hay sesión o
  internet, se reintenta al entrar o desde **Mi cuenta → Subir pendientes**.
  Si la auditoría ya fue enviada en la nube, no se modifica; al borrarla en el
  Historial también se borra su copia en borrador.

### En curso (rama `fase-1-permisos`)
- **Migración 001** (`docs/migraciones/001-permisos-y-conformidad.sql`): la monitora edita el catálogo; se quita el flujo aprobar/rechazar y la jefa deja una conformidad diaria opcional (`audit_conformity`, una observación); `delete_all_audits('BORRAR TODO')` solo para el administrador; el administrador ve solo perfiles de su local. Probada en PGlite (`npm run test:schema`). **Aún no aplicada en Supabase.**
- Antes de aplicarla: desactivar el registro público en Supabase (Authentication → Sign In / Providers) y crear los usuarios desde el panel.
- Las pruebas `flujos.test.js` están desfasadas respecto de la versión modular con login y deben adaptarse.

### Pendiente
- Fase 1: escribir las auditorías en Supabase (guardado por partes), permisos
  por rol en la app y gestión de usuarios desde la interfaz.
- Fase 2: mejoras locales (historial de solo lectura, conformidad de la jefa,
  borrado con respaldo).
- Fase 3: leer y escribir en Supabase (proveedor `supabase-provider.js`),
  guardado por partes y subida de fotos a Storage.
- Trasladar los datos actuales del navegador al local, una sola vez.
- Definir qué ocurre al rechazar una auditoría (si la monitora corrige y
  reenvía).
