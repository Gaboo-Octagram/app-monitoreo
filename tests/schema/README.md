# Prueba del esquema de base de datos

Comprueba `docs/schema.sql` sin tocar Supabase. Ejecuta el archivo en **PGlite**
(un PostgreSQL real dentro del navegador) con `auth` y `storage` simulados, y
prueba los permisos de los tres roles.

## Cómo ejecutarla

Desde la raíz del repositorio:

```
python -m http.server 8000
```

Abrir <http://localhost:8000/tests/schema/test.html> y, en la consola del
navegador (F12), escribir:

```js
await runTest()
```

Devuelve una lista de comprobaciones. Al final debe decir **RESULTADO: TODO OK**.

## Qué revisa

- Las 16 tablas existen y todas tienen RLS activo.
- Los datos iniciales: 7 áreas, 14 bloques, 70 ítems, 6 parámetros.
- Alta automática de perfiles: el primer usuario es administrador.
- Una monitora crea su auditoría, agrega ítems, fotos y la envía.
- Otra monitora no ve ni edita la auditoría ajena.
- La jefa ve, revisa y aprueba, pero no cambia los hallazgos.
- Nadie se asigna un rol a sí mismo ni crea perfiles.
- Un usuario sin sesión no lee nada.
- No se suben fotos con la ruta de otro local.

Requiere conexión a internet: PGlite se carga desde un CDN.
