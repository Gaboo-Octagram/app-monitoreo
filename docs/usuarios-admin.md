# Usuarios desde Configuración (solo administrador)

La pestaña **Configuración → Usuarios** permite al administrador crear usuarios, cambiar su rol,
restablecer su contraseña, cambiar su nombre y desactivarlos. Todo pasa por una función segura
de Supabase (`admin-users`), porque crear usuarios y cambiar contraseñas requiere la llave de
servicio, que nunca debe estar en el navegador.

## Publicar la función (una sola vez)

1. Supabase → **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Nombre: `admin-users` (exactamente así).
3. Pega todo el contenido de `supabase/functions/admin-users/index.ts` y pulsa **Deploy**.
4. Deja activada la opción **Verify JWT** (viene activa por defecto).
5. No hay que crear secretos: Supabase entrega `SUPABASE_URL`, `SUPABASE_ANON_KEY` y
   `SUPABASE_SERVICE_ROLE_KEY` a la función automáticamente.

Si cambias el archivo, vuelve a pegarlo y a publicar.

## Reglas

- Solo entra a la pestaña quien tiene rol **administrador** (la función lo vuelve a comprobar).
- Usuario: 3 a 30 caracteres (letras, números, `.`, `_`, `-`). Se guarda en minúsculas;
  internamente es `usuario@sistema-calidad.app`.
- Contraseña: mínimo 8 caracteres.
- Roles: Administrador, Jefa de calidad, Monitora. Se pueden cambiar cuando se necesite.
- Nadie puede cambiar su propio rol ni desactivarse a sí mismo.
- Desactivar bloquea el acceso y conserva el historial.
- Cada persona puede cambiar su contraseña en **Mi cuenta → Cambiar mi contraseña**.
