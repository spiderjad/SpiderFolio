# Visibilidad y gestión de personas

Fuente de verdad del modelo de seguridad de personas. Todo se decide en el servidor; la interfaz solo oculta.

## Principios

- Denegado por defecto.
- Rol = alcance en toda la empresa; cargo (jefe/subjefe) = alcance en su área y subáreas (a cualquier profundidad).
- Nadie da más de lo que tiene ni actúa sobre roles iguales o superiores.
- Fuera de alcance = 404.

## Ver personas

- **Directorio** (nombre, puesto, departamento): propietario, admin, jefe y subjefe ven a todos. Miembro: según la opción de Seguridad "Los miembros ven": toda la empresa (por defecto) o solo su departamento; con "solo su departamento" ve a las personas de sus departamentos más los jefes de las demás áreas. Lector e invitado: solo su propio perfil.
- **Email, último acceso, plaza, estado e invitaciones pendientes**: propietario y admin, todos; jefe y subjefe, solo su área y subáreas; el resto, nadie.
- **Organigrama**: propietario, admin, jefe y subjefe, completo; miembro, según la opción; lector e invitado, no.

## Gestionar personas

- **Invitar**: propietario y admin sin restricción. Jefe y subjefe, por defecto sí, solo como Miembro o Lector y solo a sus departamentos y subáreas; la opción de Seguridad "Los jefes pueden invitar a su área" (activada por defecto) permite desactivarlo. Cada invitación de un jefe notifica a los administradores y queda en Invitaciones pendientes, donde pueden revocarla. Los límites de plazas se aplican igual.
- **Cambiar rol, plaza, suspender, quitar**: propietario y admin (el admin no puede actuar sobre propietarios ni otros admins). Jefes no.
- **Agregar/quitar de departamentos**: propietario y admin en todos; jefe/subjefe solo en su área y subáreas.
- **Nombrar jefe/subjefe**: propietario y admin; un jefe puede nombrar subjefes de su área.
- **Facturación y borrar el workspace**: solo propietario. **Seguridad**: las opciones generales son del propietario; Seguridad › Email (remitente de email propio) también la gestionan los administradores con `security.manage`.

## Casos límite

- Varios departamentos = suma de alcances.
- Cambios de cargo o departamento aplican en la siguiente petición.
- Siempre al menos un propietario (no se suspende ni se quita; solo se transfiere).
- Un lector no puede ser jefe con permisos (su cargo no le da alcance).
- Suspendidos visibles solo para gestores, marcados.
- Con "solo su departamento", menciones y compartir con personas se limitan a quien ve; siempre se puede compartir con un departamento por nombre.

## Implementación

- Una función única calcula el alcance de quien pregunta: `peopleScopeOf` (backend/src/modules/people/people-scope.ts), con caché por petición.
- El filtrado va en la consulta SQL.
- Dos DTO según el público: directorio (nombre, puesto, departamentos) y gestión (email, plaza, estado, último acceso). En el organigrama, los campos de gestión solo llegan para personas dentro del alcance de gestión de quien pregunta.
- Auditoría de cambios de rol, cargo, departamento, plaza y configuración.
- Ajustes en `Workspace.settings`: `memberVisibility` (`company` | `department`) y `leadersCanInvite` (por defecto `true`).
- Interfaz: nota "Como administrador ves a toda la empresa" cuando la opción de visibilidad está activa.

## Tests

Matriz rol × acción × opción de Seguridad contra la API: `backend/tests/integration/people-matrix.test.ts` (incluida en el test de aislamiento por las rutas que recorre).
