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
├── src/        # Código fuente (index.html, app.js, styles.css)
├── tests/      # Pruebas simuladas
├── docs/       # Documentación/imágenes de referencia
├── PLAN.md     # Plan de trabajo
└── README.md
```

## Uso local
Abrir `src/index.html` en un navegador moderno. No requiere servidor para la versión actual.

## Estado
- Versión: 2.0 (base)
- Almacenamiento: localStorage (solo navegador)
- Migración prevista a Supabase según PLAN.md

## Licencia
Sin licencia. Todos los derechos reservados.
