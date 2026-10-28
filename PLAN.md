# Plan de trabajo — Sistema de Calidad (piloto)

Actualizado: 28-10-2026. Estado actual: versión 2 funcionando, con datos guardados solo en el navegador. Las decisiones de abajo están confirmadas.

## Seguimiento

Fase 0 — Preparación
- [x] Repositorio en GitHub con la versión 2 como línea base
- [x] Estructura en carpetas, README y .gitignore
- [x] PLAN.md completo y pruebas simuladas en `tests/`
- [ ] Etiqueta `v2.0`
- [ ] Proyecto Supabase (sin datos reales)
- [ ] Confirmar el hosting

Fases 1 a 5: pendientes.

## 1. Decisiones confirmadas

- Piloto personal de Gabriel para apoyar a la monitora de calidad. Posible venta a la empresa más adelante.
- Roles: Administrador (Gabriel), Monitora de calidad y Jefa de calidad. Los jefes de área quedan fuera por ahora.
- La auditoría se edita solo en Inicio, antes de guardarla. El Historial es de solo lectura.
- Una auditoría por día. El borrador se guarda en la nube para continuar desde cualquier equipo.
- Conformidad de la jefa: diaria, no obligatoria y no bloquea nuevas auditorías (pueden pasar varios días sin revisión). Puede dejar una observación simple, sin hilo ni respuestas. Imprimirla en el PDF queda para más adelante, cuando exista el formato.
- La monitora administra la Configuración, porque necesita definir los parámetros y los ítems que se evalúan. Cuando todo esté listo se ajustarán los permisos.
- Solo el administrador puede borrar el historial, completo y no por día, descargando antes un respaldo.
- Durante el piloto se usan nombres de personas ficticios, como en los datos de ejemplo actuales. No se cargan nombres de trabajadores reales ni fotos de personas.
- Repositorio privado en GitHub, editado solo por Gabriel por ahora.
- Equipos: evaluar en tablet, ver en computador, celular de apoyo. Hay wifi en todas las áreas; el modo sin conexión es una fase posterior.
- Tecnología: HTML/CSS/JS, publicación gratuita y Supabase (base de datos, login, permisos y fotos). Se revisa si se vende.

## 2. Permisos

| Acción | Administrador | Monitora | Jefa de calidad |
|---|---|---|---|
| Iniciar sesión | Sí | Sí | Sí |
| Evaluar en Inicio y guardar la auditoría | Sí | Sí | No |
| Ver Historial | Sí | Sí | Sí |
| Ver Resumen e informes | Sí | Sí | Sí |
| Dar conformidad y dejar observación | No | No (solo la ve) | Sí |
| Configuración (áreas, trabajadores, checklists, parámetros) | Sí | Sí | No |
| Administrar usuarios y roles | Sí | No | No |
| Borrar historial | Sí | No | No |

Los permisos se aplican en la base de datos, no solo ocultando botones. Se definen en un solo lugar, para poder ajustarlos al final sin reescribir la app.

## 3. Fases

Tamaños relativos: S pequeña, M mediana, L grande.

### Fase 0 — Preparación (S)
- Subir la versión 2 a un repositorio de GitHub como línea base, con etiqueta v2.0.
- Ordenar el proyecto en carpetas y agregar README, .gitignore, este plan y las pruebas simuladas.
- Crear el proyecto en Supabase, sin datos reales.
- Confirmar el hosting (ver sección 5).
- Criterio de listo: el repositorio tiene la v2 etiquetada y existe un proyecto Supabase vacío.

### Fase 1 — Nube y acceso (L)
- Esquema de base de datos preparado para varios locales.
- Login por correo, solo por invitación, con tres roles y permisos aplicados en la base de datos.
- Pasar el guardado de LocalStorage a Supabase: configuración, borradores, auditorías y fotos.
- Separar la capa de datos del resto del código, para poder cambiar de proveedor después.
- Datos de demostración con nombres ficticios, sin fotos de personas.
- Criterio de listo: la monitora inicia sesión en la tablet, evalúa y guarda; la jefa entra desde otro equipo y ve lo guardado; la monitora no accede a lo de administrador.

### Fase 2 — Historial, conformidad y borrado (M)
- Historial de solo lectura, sin Editar ni Eliminar por día.
- Agrupar por mes, semana y día. Mes actual abierto, el resto plegado, con resumen por grupo (promedio, hallazgos y días por revisar). Los filtros actuales se mantienen.
- Estado de revisión por día: Pendiente de revisión o Conforme, con una observación opcional de la jefa (un solo texto). La monitora la ve en el Historial. Nada de esto bloquea nuevas auditorías.
- Borrar historial completo, solo administrador, con doble confirmación y descarga de respaldo obligatoria.
- Registro de acciones críticas: conformidades, observaciones, borrados y cambios de usuarios.
- Criterio de listo: la jefa da conformidad y deja una observación, la monitora la ve, y el administrador reinicia el historial con respaldo.
- Hito demostrable: al terminar esta fase ya se puede mostrar el sistema completo a la empresa.

### Fase 3 — Resumen y uso en tablet y celular (M)
- Resumen conectado a la nube, con contador de días pendientes de revisión.
- Inicio pensado primero para tablet: botones más grandes y modal de higiene cómodo al tacto.
- Celular: columnas apiladas y cámara directa desde la observación.
- Probar en tablet y celular reales.

### Fase 4 — Modo sin conexión (L)
- App instalable en la tablet.
- Lo marcado se guarda en el equipo y se sincroniza al volver la señal, con indicador de conectado, sin conexión o sincronizando.
- Fotos en cola de envío.
- Criterio de listo: en modo avión se evalúa un área completa, y al reconectar todo aparece en el historial.

### Fase 5 — Respaldo, publicación y pulido (S a M)
- Respaldo automático semanal, porque el plan gratuito de Supabase no los incluye.
- Evitar que el proyecto se pause por inactividad.
- Revisión de seguridad: permisos, claves y datos.
- Informe PDF con conformidad, cuando exista el formato.
- Revisar y ajustar los permisos finales de cada rol.

### Más adelante (sin fecha)
- Aviso de días sin revisar.
- Acciones correctivas con seguimiento (abierta, en proceso, cerrada).
- Exportar a Excel.
- Purga de fotos antiguas conservando el texto.

## 4. Modelo de datos (resumen)

Locales, perfiles de usuario con rol, áreas, bloques e ítems de checklist, parámetros de personal, trabajadores y su asignación a áreas, borradores, auditorías (una por día y local), resultados por área, entradas de cada check, fotos, revisiones con observación, y registro de acciones.

## 5. GitHub y publicación

- Estructura: README.md, PLAN.md, src/ (index.html, styles.css, app.js), tests/ (pruebas simuladas) y docs/ (imágenes de referencia).
- Rama main estable, una rama por fase y una etiqueta por versión (v2.0, v3.0…). Commits pequeños y descriptivos.
- Nunca subir claves secretas, respaldos .json ni fotos. La clave pública de Supabase puede ir en el código; la clave de servicio, jamás.
- Elegir la licencia a propósito: sin licencia, todos los derechos quedan reservados.

### Hosting con repositorio privado

GitHub Pages desde un repositorio privado requiere un plan de pago (Pro, Team o Enterprise). Alternativas gratuitas revisadas el 28-10-2026:

- **Cloudflare Pages (recomendado):** plan gratuito con 500 compilaciones al mes, 20.000 archivos por sitio y 25 MiB por archivo. La documentación no declara límite de ancho de banda. No se pudo confirmar en la documentación si el plan gratuito admite repositorios privados; se comprueba al conectarlo.
- **Netlify:** el plan gratuito da 300 créditos al mes, y si se superan el sitio se pausa hasta el mes siguiente. Los repositorios privados de organización figuran solo en el plan Pro.
- **GitHub Pro (de pago):** permite Pages desde repositorio privado.

El sitio publicado es accesible por internet; lo que protege los datos es el login y los permisos de la base de datos.

## 6. Riesgos

- Plan gratuito de Supabase: se pausa tras 7 días sin uso, no incluye respaldos automáticos y tiene 1 GB para archivos.
- Hosting gratuito: sus límites y condiciones pueden cambiar; revisar antes de depender de ellos.
- Datos reales de trabajadores sin autorización de la empresa: usar solo nombres ficticios durante el piloto.
- Sin conexión: pueden aparecer conflictos si se edita el mismo borrador desde dos equipos a la vez.

## 7. Pendiente

De Gabriel:
- Crear la cuenta y el proyecto en Supabase.
- Formato del informe PDF, cuando lo tenga.
- Listas reales de áreas, trabajadores e ítems, cuando estén disponibles.
