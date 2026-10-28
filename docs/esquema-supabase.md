# Esquema de la base de datos (Supabase)

Este documento explica, en lenguaje simple, qué contiene `docs/schema.sql`: el
"plano" de la base de datos que usará la app cuando dejemos localStorage.

> **Estado:** el archivo **ya se ejecutó** en el proyecto real de Supabase
> (16 tablas, permisos, Storage y datos iniciales). La app, por ahora, sigue
> guardando las auditorías en el navegador: falta conectar la lectura y la
> escritura.

---

## 1. Qué es y qué no es

`docs/schema.sql` es un archivo de texto con instrucciones para PostgreSQL (el
motor que usa Supabase). Si se pega en Supabase, crea:

- 16 tablas (dónde se guardan los datos),
- las relaciones entre ellas,
- los permisos por rol, aplicados **en la base de datos**,
- dos depósitos de archivos (fotos e informes),
- datos iniciales (las 7 áreas con sus checklists y los parámetros de higiene).

No contiene contraseñas, correos ni datos de personas. No borra nada: se puede
volver a ejecutar sin romper lo anterior.

---

## 2. Las tablas, por grupos

### Locales y personas

| Tabla | Qué guarda |
|---|---|
| `stores` | Los locales o sucursales (por ahora, uno). |
| `profiles` | Una ficha por usuario: nombre, rol, local y si está activo. El rol no lo puede cambiar el propio usuario. |
| `bosses` | Los jefes de área (nombre y cargo). |
| `workers` | Los trabajadores que se evalúan. |

### Catálogo (lo que se evalúa)

| Tabla | Qué guarda |
|---|---|
| `areas` | Panadería, Carnicería, etc., con su jefe asignado y su orden. |
| `area_workers` | Qué trabajadores pertenecen a cada área ("toda el área"). |
| `checklist_blocks` | Los bloques de cada área: Limpieza y Orden. |
| `checklist_items` | Cada ítem de esos bloques ("Pisos limpios…"). |
| `hygiene_params` | Los parámetros de higiene por trabajador (lavado de manos, cofia…). |

### Auditorías

| Tabla | Qué guarda |
|---|---|
| `audits` | La cabecera: fecha, estado, quién evaluó, meta, notas y la revisión de la jefa. |
| `audit_area_results` | El resultado de cada área dentro de esa auditoría. |
| `audit_blocks` | Los bloques evaluados (trabajadores, limpieza, orden). |
| `audit_entries` | Cada ítem evaluado: texto, estado (cumple / no cumple / N/A) y observación. |
| `audit_absences` | Los trabajadores ausentes ese día. |
| `audit_photos` | Una fila por foto; el archivo en sí va a Storage. |
| `attachments` | Informes y archivos subidos a mano (pestaña "Archivos"). |

### Cómo se relacionan (resumen)

```
stores
 ├── profiles (usuarios)
 ├── bosses, workers
 ├── areas ── area_workers ── workers
 │     └── checklist_blocks ── checklist_items
 ├── hygiene_params
 ├── audits ── audit_area_results ── audit_blocks ── audit_entries ── audit_photos
 │                                └── audit_absences
 └── attachments
```

Cada auditoría guarda **copias** de los nombres y textos que se evaluaron
(`area_name`, `worker_name`, `item_text`, `boss_name`). Así, si mañana se
renombra un área o se borra un trabajador, el historial sigue mostrando lo que
realmente se evaluó ese día. Las columnas que apuntan al catálogo pueden quedar
vacías sin romper nada.

---

## 3. Roles y permisos

Hay tres roles:

- **Administrador:** administra el local, el catálogo y los usuarios.
- **Monitora de calidad:** hace las auditorías de su local.
- **Jefa de calidad:** revisa y aprueba o rechaza las auditorías enviadas.

La regla se aplica **en la base de datos**, no solo escondiendo botones. Aunque
alguien llame a la API directamente, la base lo frena.

| Acción | Administrador | Monitora | Jefa de calidad |
|---|---|---|---|
| Ver el catálogo (áreas, ítems, trabajadores) | Sí | Sí | Sí |
| Crear / editar / borrar catálogo y trabajadores | Sí | No | No |
| Gestionar usuarios y roles | Sí | No | No |
| Ver auditorías | Todas las de su local | Solo las suyas | Todas las de su local |
| Crear una auditoría | Sí | Sí | No |
| Editar un borrador | Sí | Solo los suyos | No |
| Enviar la auditoría | — | Sí (la suya) | — |
| Aprobar / rechazar | Sí (puede) | No | Sí, las enviadas |
| Cambiar hallazgos ya enviados | Sí | No | **No** |
| Ver fotos | Sí | Solo de sus auditorías | Sí |
| Borrar una auditoría | Sí | Solo su borrador | No |
| Subir informes | Sí | Sí | Sí |
| Borrar informes | Sí | Solo los que subió | Sí |

Además:

- Una monitora **no puede** cambiarse el rol, el local ni reactivarse.
- Una auditoría enviada ya no se puede editar; solo la jefa puede aprobarla o
  rechazarla.
- La jefa no puede tocar los hallazgos: aunque lo intente, la base conserva los
  datos originales.
- El rol "anónimo" (sin sesión) no puede leer nada.

### El recorrido de una auditoría

```
borrador (monitora)  →  enviada  →  revisada (jefa: aprobada o rechazada)
```

Si la jefa rechaza, queda registrado el motivo en `review_notes` para que la
monitora sepa qué corregir. Reabrir una auditoría revisada todavía no está
previsto: habría que decidir si se permite y cómo.

---

## 4. Fotos e informes (Storage)

Los archivos no se guardan dentro de las tablas; van a dos depósitos privados:

| Depósito | Contenido | Límite | Ruta |
|---|---|---|---|
| `audit-photos` | Fotos de los ítems | 2 MB | `<local>/<auditoría>/archivo.jpg` |
| `attachments` | Informes y archivos | 1,5 MB | `<local>/archivo.pdf` |

Solo se aceptan imágenes (JPG, PNG, WebP) en fotos, y PDF, imágenes o documentos
de Office en informes. El acceso también se controla por rol y por local: nadie
de otro local puede abrir una foto aunque tenga el enlace.

---

## 5. Datos iniciales

La función `create_store_with_defaults('Nombre del local')` crea un local con:

- 7 áreas: Panadería, Pastelería, Carnicería, Rostisería, Frutería y
  Verdulería, Sala de Ventas y Bodega.
- 2 bloques por área (Limpieza y Orden) con 5 ítems cada uno: 70 ítems.
- 6 parámetros de higiene por trabajador.

Es la misma base que trae la app hoy. Se ejecuta una vez desde el SQL Editor:

```sql
select public.create_store_with_defaults('Supermercado Centro');
```

---

## 6. Cómo ejecutarlo en Supabase (referencia)

> Ya está aplicado en el proyecto. Estos pasos sirven si hay que recrear la
> base en otro proyecto o revisar el proceso.

1. Entrar al proyecto en <https://supabase.com>.
2. Menú **SQL Editor** → **New query**.
3. Abrir `docs/schema.sql`, copiar todo y pegar.
4. Pulsar **Run**. Debería terminar sin errores.
5. Comprobar (opcional, al final del archivo hay consultas de solo lectura):
   - 16 tablas y las 16 con RLS activo.
   - Las políticas creadas.
6. En **Storage** deben aparecer los depósitos `audit-photos` y `attachments`.
7. En **Authentication → Users**, crear el primer usuario. Ese primero queda
   como **administrador** automáticamente; los siguientes entran como monitoras
   y el administrador les cambia el rol.
8. Ejecutar `create_store_with_defaults(...)` para cargar el catálogo.

> Si un depósito ya existiera, el archivo no falla: lo respeta.

---

## 7. Decisiones tomadas (y por qué)

- **Una auditoría por local y día.** Es lo que hace la app hoy: si ya hay una
  del mismo día, se fusiona. Si algún día se necesitan varias por día, se quita
  el índice `unique (store_id, audit_date)`.
- **Un local por administrador.** El perfil tiene un solo `store_id`. Para
  varios locales haría falta una tabla intermedia de "quién administra qué".
- **Copias de nombres y textos** en la auditoría, para que el historial no
  cambie si se edita el catálogo.
- **Permisos en la base (RLS + triggers).** No dependen del navegador.
- **Fotos en Storage**, no como texto en la base.
- **Borrado lógico** en el catálogo (`active = false`) en lugar de borrar, para
  no romper auditorías viejas.
- **Sin claves especiales en el archivo.** Solo usa funciones internas y los
  roles normales de Supabase.

---

## 8. Cómo se probó

No se ejecutó en el proyecto real. Se ejecutó en **PGlite** (un PostgreSQL real
compilado a WebAssembly) simulando las partes de Supabase que el esquema usa
(`auth`, `storage`, roles `anon` y `authenticated`).

La prueba está en `tests/schema/test.html` y comprueba 36 puntos:

- Las 16 tablas existen y todas tienen RLS.
- Se crean las 7 áreas, 14 bloques, 70 ítems y 6 parámetros.
- El primer usuario es administrador y los demás monitoras.
- Una monitora crea y completa su auditoría, con foto.
- Otra monitora **no** la ve ni la puede editar.
- La jefa la ve, no puede tocar los hallazgos y sí puede aprobarla.
- Una auditoría enviada o revisada ya no se puede editar.
- Nadie puede ascenderse de rol ni inventar perfiles.
- Un usuario sin sesión no lee nada.
- No se pueden subir fotos con la ruta de otro local.

Resultado: **todo OK**. También se validó la sintaxis y los cuerpos de las
funciones con `pglast` (el analizador oficial de PostgreSQL).

Cómo repetirla:

```
python -m http.server 8000
# abrir http://localhost:8000/tests/schema/test.html
# en la consola del navegador:  await runTest()
```

---

## 9. Qué falta para conectar la app

1. ~~Pantalla de inicio de sesión~~ — **hecha** (`src/auth.js`): correo y
   contraseña, sesión recordada, nombre y rol, y opción "Seguir sin conexión".
   Todavía no aplica permisos porque los datos son locales.
2. **Lectura desde Supabase** — **hecha** (`src/data/supabase-read.js`): lee
   áreas, checks, parámetros, trabajadores y auditorías, y los cuenta en
   "Mi cuenta → Datos en la nube". Todavía no reemplaza al almacenamiento
   local.
3. **Proveedor `supabase-provider.js`** completo (lectura + escritura) que
   cumpla el contrato de `AppData` y se active con `AppData.use('supabase')`.
4. **Adaptar `app.js`** a las diferencias: hoy guarda todo el estado de una vez
   (`saveDB`); con Supabase habrá que guardar por partes y subir las fotos
   aparte.
5. **Migrar los datos del navegador** (una sola vez) al local del usuario.
6. **Ajustar los informes** para que incluyan las fotos guardadas en Storage.
7. **Definir qué pasa al rechazar**: ¿la monitora corrige y reenvía? Eso pide
   una transición nueva en el esquema.
