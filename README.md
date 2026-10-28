# Sistema de Calidad — Control de Auditorías e Inspecciones

App web vanilla (HTML/CSS/JS) para control de auditorías e inspecciones en supermercados. Datos guardados en localStorage en la versión actual (v2). En futuras fases se migrará a Supabase con autenticación, roles y permisos.

## Características (v2)
- Acceso opcional con cuenta de Supabase; se puede trabajar sin conexión
- Auditorías por área con checks de Limpieza/Orden y evaluación de trabajadores
- Validación obligatoria de observación/foto en "No conforme"
- Borradores por área con guardado diferido (se agrupan y se escriben al cerrar)
- Aviso "Guardado" en la barra superior y contador de espacio usado
- Merge de auditorías si ya existe una del mismo día
- Historial con filtros, búsqueda rápida, edición desde historial y resumen con gráficas
- Exportar el historial filtrado a CSV (se abre en Excel)
- Generación de informes imprimibles/PDF
- Gestión de áreas, trabajadores, jefes, checklists, parámetros y archivos
- Compresión de fotos en cliente
- Interfaz usable con teclado: foco visible, diálogos que atrapan el foco y Escape para cerrar

## Estructura
```
/
├── src/
│   ├── index.html              # Página principal (orden de carga de scripts)
│   ├── app.js                  # Estado, vistas y eventos de la app
│   ├── styles.css              # Estilos
│   ├── supabaseClient.js       # Claves reales (NO se sube al repo)
│   ├── supabaseClient.example.js # Plantilla pública
│   ├── auth.js                 # Acceso con Supabase (correo y contraseña)
│   ├── lib/
│   │   ├── util.js             # Funciones puras (texto, fechas, descargas)
│   │   ├── constants.js        # Etiquetas, colores e iconos
│   │   └── photos.js           # Compresión de fotos y miniaturas
│   ├── data/
│   │   ├── model.js            # Estructura de los datos, valores iniciales y migración
│   │   ├── provider.js         # Fachada AppData (contrato de datos)
│   │   ├── local-storage-provider.js # Implementación actual
│   │   └── supabase-read.js    # Lectura desde Supabase (solo consulta)
│   └── features/
│       ├── report.js           # Informe imprimible/PDF
│       └── csv.js              # Armar y descargar CSV
├── tests/      # Pruebas simuladas
│   └── schema/ # Prueba del esquema SQL en PGlite
├── docs/
│   ├── schema.sql            # Esquema para Supabase (ya aplicado)
│   └── esquema-supabase.md   # Explicación del esquema en lenguaje simple
├── PLAN.md     # Plan de trabajo
└── README.md
```

Los archivos de `lib/`, `data/` y `features/` se cargan con `<script>` normal
antes de `app.js`, sin módulos ES: así la app sigue abriéndose con doble clic
(`file://`). Cada archivo agrupa una responsabilidad y no guarda estado propio.

## Guardado en la nube (en prueba)
Al guardar una auditoría, la app sigue escribiendo la copia del navegador y
además intenta subirla a Supabase (`src/data/supabase-write.js`):

- Se sube como **borrador**; si ya existe una del mismo día, se reemplaza.
- Si la auditoría ya fue enviada o revisada en la nube, no se toca.
- Las fotos van a Storage en `<local>/<auditoría>/<check>/n.jpg`.
- Sin sesión o sin internet no pasa nada: queda guardada en el navegador y se
  reintenta al iniciar sesión, al abrir la app o desde **Mi cuenta → Subir
  pendientes**.
- Los nombres de áreas, checks, parámetros y trabajadores se enlazan con el
  catálogo de la nube; si alguno no coincide, se conserva el texto evaluado.

## Capa de datos
La app **no** llama a `localStorage` directamente: todo pasa por `AppData`
(`src/data/provider.js`). El proveedor activo se elige en una sola línea de
`src/data/local-storage-provider.js`:

```js
AppData.use('localStorage');   // hoy
// AppData.use('supabase');    // cuando exista supabase-provider.js
```

Los métodos son asíncronos a propósito (`await AppData.saveDB(db)`, etc.) para
que el cambio a Supabase no obligue a reescribir la interfaz.

## Acceso
Al abrir, la app muestra una pantalla para entrar con la cuenta de Supabase
(correo y contraseña), con la opción **Seguir sin conexión**.

- La sesión se recuerda entre visitas; si se cierra sesión, vuelve la pantalla.
- Con sesión iniciada, la barra superior muestra el nombre y el rol, y ese botón
  abre **Mi cuenta** (rol, local, correo y cerrar sesión).
- La lógica está en `src/auth.js`, separada de las auditorías.
- **Mi cuenta → Datos en la nube → Comprobar** lee el catálogo del local y
  cuenta las auditorías que hay en Supabase. Solo lee: no cambia ni sube nada.
- **Todavía no aplica permisos**: los roles se harán efectivos cuando la app
  lea y escriba en Supabase. Hasta entonces los datos siguen en el navegador.

## Uso local
Abrir `src/index.html` en un navegador moderno, o servirlo con
`python -m http.server 8000 --directory src` y entrar a `http://localhost:8000`.
El servidor local es recomendable si se usa el cliente de Supabase, porque
algunos navegadores bloquean peticiones externas desde `file://`.

## Supabase
- Copiar `src/supabaseClient.example.js` a `src/supabaseClient.js` y rellenar
  URL y anon key.
- Ese archivo está en `.gitignore`: **nunca** subir claves ni respaldos.
- La conexión se inicializa sola y queda disponible en `window.sb`.
- La base ya está creada y con datos iniciales; la app todavía guarda las
  auditorías en el navegador.
- `src/data/supabase-read.js` lee el catálogo y las auditorías de la nube
  (primera parte del futuro `supabase-provider.js`). Se prueba desde
  **Mi cuenta → Datos en la nube**.
- El diseño de la base está en `docs/schema.sql`, explicado en
  `docs/esquema-supabase.md`.
- Para repetir la prueba del esquema: `tests/schema/` (ver su README).

## Pruebas
```
cd tests
npm install
npm test
```
Más detalle en `tests/README.md`.

## Estado
- Versión: 2.6 (primer guardado en la nube, en prueba)
- Almacenamiento: localStorage (copia principal) + copia en Supabase al guardar
- Cliente Supabase: conectado; inicio de sesión, rol y lectura del catálogo
- Base de datos: tablas, permisos y Storage creados en el proyecto real
- Esquema SQL: validado con 36 comprobaciones (`tests/schema/`)
- Siguiente: probar la subida con una cuenta real y definir el envío a revisión

## Licencia
Sin licencia. Todos los derechos reservados.
