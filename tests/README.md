# Pruebas simuladas

Prueban los flujos principales de `src/` con jsdom, un navegador simulado. No necesitan servidor ni cuenta de Supabase, y usan solo datos ficticios.

## Cómo ejecutarlas

```
cd tests
npm install
npm test
```

Requiere Node 18 o superior.

## Qué cubren

- Migración de datos desde la versión 1.
- Configuración: trabajadores, áreas, bloques con sub-área, ítems y parámetros.
- Inicio: progreso, estados del área, trabajadores ausentes, modal de higiene, validación de observación o foto y confirmación de pendientes.
- Guardado de la auditoría y combinación de auditorías del mismo día.
- Historial: tarjetas por área, observaciones, filtros y edición.
- Resumen e informe imprimible.
- Fotos: miniatura y ampliación.
- Escape de texto del usuario (XSS).

## Notas

- Prueban `src/` tal como está. Cuando cambie el modelo de datos (Fase 1 en adelante) hay que actualizarlas.
- En la Fase 2 el Historial pasa a solo lectura: las pruebas de edición del Historial deben retirarse.
