# Conector para Claude (servidor MCP)

SpiderFolio expone un servidor MCP remoto para que cada persona conecte su Claude (u otro asistente
compatible) y busque, lea y, con el plugin de pago, cree y edite la documentación de su empresa con sus
propios permisos. Las herramientas viven en el núcleo y llaman a los mismos servicios que la app; los
plugins solo las habilitan por empresa (`features`):

| Plugin | Distribución | Habilita |
|---|---|---|
| `claude-connector` «Conector para Claude» | Oficial gratis | `mcp_read` |
| `mcp-connector` «Conector para Claude: edición» | De pago, `replaces: ["claude-connector"]` | `mcp_read` y `mcp_write` |

Las conexiones (OAuth) son datos del núcleo, no de un plugin: al pasar de uno a otro siguen funcionando;
si queda solo el gratis, la misma conexión pierde la escritura y la recupera al volver el de pago.

## Versiones de las especificaciones (leídas el 29/10/2026)

- **MCP vigente: 2026-07-28.** Quita las sesiones y el `initialize` (cada pedido lleva su versión en
  `_meta` y en cabeceras `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name`). Ni Claude ni el SDK oficial
  la hablan todavía: Claude sigue las especificaciones de autorización 2025-03-26, 2025-06-18 y
  2025-11-25, y `@modelcontextprotocol/sdk` 1.32.2 llega a 2025-11-25.
- **Lo que implementamos: transporte 2025-11-25** (Streamable HTTP con `initialize`), **sin estado**:
  cada POST a `/mcp` se atiende solo, sin `Mcp-Session-Id`; GET y DELETE responden 405. Cuando Claude y
  el SDK adopten la 2026-07-28, el servidor pasa a ser «dual» (ver «Versioning: Backward Compatibility»
  de la especificación) sin cambiar las herramientas.
- **Autorización: la de 2026-07-28**, que es compatible con la que usa Claude:
  - Metadatos del recurso protegido (RFC 9728) en `/.well-known/oauth-protected-resource/mcp` y en
    `/.well-known/oauth-protected-resource`, con `resource` = `APP_URL/mcp` exacto,
    `authorization_servers` = [`APP_URL`] y `scopes_supported`.
  - Un pedido sin token o con uno inválido responde **401** con
    `WWW-Authenticate: Bearer resource_metadata="…", scope="docs:read docs:write"` (Claude pide justo esos; la pantalla de autorizar concede escribir solo a quien puede). Claude solo inicia el login con
    un 401. Alcance insuficiente: **403** con `error="insufficient_scope"` y el alcance que falta.
  - Metadatos del servidor de autorización (RFC 8414) en `/.well-known/oauth-authorization-server`, con
    `issuer` = `APP_URL`, `code_challenge_methods_supported: ["S256"]`,
    `token_endpoint_auth_methods_supported: ["none"]`, `client_id_metadata_document_supported: true`,
    `registration_endpoint` y `authorization_response_iss_parameter_supported: true`.
  - Registro del cliente: **Client ID Metadata Documents** (recomendado por la especificación; Claude lo
    usa con «Use Claude's published identity» si se anuncian `client_id_metadata_document_supported` y
    `none`) y **registro dinámico** (RFC 7591, obsoleto pero Claude lo usa con «Register automatically»).
    Al traer un documento CIMD: solo `https`, sin IP privadas ni redirecciones, tamaño y tiempo
    acotados, `client_id` del documento idéntico a la URL, y caché.
  - PKCE S256 obligatorio; `resource` (RFC 8707) obligatorio e igual a `APP_URL/mcp`; el token queda
    ligado a ese recurso y `/mcp` rechaza cualquier otro.
  - Redirecciones: coincidencia exacta con las registradas, salvo loopback (`http://localhost` y
    `http://127.0.0.1`), que coincide sin puerto (Claude Code). Claude.ai usa
    `https://claude.ai/api/mcp/auth_callback`. La pantalla de consentimiento muestra el host de la
    redirección y avisa cuando solo hay loopback.
  - La respuesta de autorización lleva `iss` (RFC 9207).
  - `/oauth/token` acepta `application/x-www-form-urlencoded`. Token de acceso de 1 h; token de
    refresco rotativo con detección de reuso (reusar uno ya rotado revoca la conexión); `invalid_grant`
    cuando ya no sirve. En la base, solo hashes.
  - Claude da 10 s a descubrimiento, registro y token, y 30 s al refresco.
- **Límites de Claude:** resultado de hasta ~150.000 caracteres en claude.ai y 25.000 tokens en Claude
  Code: las respuestas se paginan con cursor por debajo de eso. 240 s por llamada.
- `Origin`: si viene y no es `APP_URL`, 403 (rebinding de DNS). Claude llama desde sus servidores
  (`160.79.104.0/21`), sin `Origin`.

Fuentes: modelcontextprotocol.io/specification/2026-07-28 (authorization, transports, versioning) y
claude.com/docs/connectors (custom/remote-mcp, building, building/authentication).

## Alcances y quién puede conectar

- `docs:read` (lectura) y `docs:write` (escritura, incluye subir archivos). `docs:write` solo se concede
  con `mcp_write` activo y a quien tiene plaza completa; un lector solo concede lectura.
- Los invitados no pueden conectar. El propietario puede desactivar el conector para la empresa
  (Administración › Seguridad): se rechazan las conexiones nuevas y las llamadas de las existentes.
- Cada conexión queda ligada a una persona y una empresa; Claude actúa con los permisos de esa persona,
  comprobados en cada llamada (un nodo sin acceso responde «no encontrado»).

## Herramientas

Lectura (`docs:read`): `search`, `list_spaces`, `list_folder`, `get_page`, `get_file`, `get_versions`,
`get_pending`, `list_expirations`.

Escritura (`docs:write`): `create_page`, `update_page` (exige `expectedVersion`), `create_folder`,
`move_node`, `upload_file`, `add_comment`, `submit_for_review`.

Lo que el conector no puede hacer, a propósito: publicar o aprobar documentos controlados, confirmar
lecturas en nombre de la persona, borrar o mandar a la papelera, cambiar permisos, gestionar miembros,
roles o departamentos, ni tocar la configuración. Editar un documento controlado publicado crea un
borrador nuevo; la versión vigente no cambia hasta que una persona lo apruebe y publique.

## Seguridad

- El contenido de los documentos es dato no confiable: va delimitado, con sus metadatos, y las
  descripciones de las herramientas son fijas.
- 60 llamadas por minuto por conexión.
- Auditoría con `{ via: "mcp", client }`: la actividad muestra «… vía Claude».
- Tests de aislamiento entre empresas para cada herramienta.
