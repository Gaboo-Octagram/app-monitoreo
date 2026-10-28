# Sistema de Calidad — Control de Auditorías e Inspecciones

App web vanilla (HTML/CSS/JS) para control de auditorías e inspecciones en supermercados. Datos guardados en localStorage en la versión actual (v2). En futuras fases se migrará a Supabase con autenticación, roles y permisos.

## Características (v2)
- Auditorías por área con checks de Limpieza/Orden y evaluación de trabajadores
- Validación obligatoria de observación/foto en "No conforme"
- Borradores por área con guardado diferido
- Merge de auditorías si ya existe una del mismo día
- Historial con filtros, edición desde historial (en v2) y resumen con gráficas
- Generación de informes imprimibles/PDF
- Gestión de áreas, trabajadores, jefes, checklists, parámetros y archivos
- Compresión de fotos en cliente

## Estructura
```
/
├── src/
│   ├── index.html              # Página principal (orden de carga de scripts)
│   ├── app.js                  # Lógica y vistas de la app
│   ├── styles.css              # Estilos
│   ├── supabaseClient.js       # Claves reales (NO se sube al repo)
│   ├── supabaseClient.example.js # Plantilla pública
│   └── data/
│       ├── provider.js         # Fachada AppData (contrato de datos)
│       └── local-storage-provider.js # Implementación actual
├── tests/      # Pruebas simuladas
│   └── schema/ # Prueba del esquema SQL en PGlite
├── docs/
│   ├── schema.sql            # Esquema para Supabase (sin ejecutar todavía)
│   └── esquema-supabase.md   # Explicación del esquema en lenguaje simple
├── PLAN.md     # Plan de trabajo
└── README.md
```

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
- Todavía no hay tablas ni datos en Supabase; la app sigue usando localStorage.
- El diseño de la base está en `docs/schema.sql`, explicado en
  `docs/esquema-supabase.md`. **No se ejecutó todavía.**
- Para repetir la prueba del esquema: `tests/schema/` (ver su README).

## Estado
- Versión: 2.2 (esquema de base diseñado y validado)
- Almacenamiento: localStorage (solo navegador), aislado tras `AppData`
- Cliente Supabase: conectado, sin uso todavía
- Esquema SQL: diseñado y probado en PGlite, pendiente de ejecutar en Supabase
- Migración prevista a Supabase según PLAN.md

## Licencia
Sin licencia. Todos los derechos reservados.
