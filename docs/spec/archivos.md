11. Archivos: reglas técnicas
Subida directa a S3 con URL prefirmada (PUT, 5 min) tras pedir permiso al backend; luego POST /files/:id/complete verifica tamaño, tipo real (magic bytes con file-type), calcula checksum y crea la FileVersion.
Tipos permitidos: PDF, DOCX, XLSX, PPTX, ODT, ODS, TXT, CSV, PNG, JPG, WEBP, ZIP. Rechazar ejecutables y HTML/SVG subidos (riesgo XSS).
Tamaño máximo por archivo y cuota según los límites que fije la empresa (docs/spec/limites.md; por defecto, sin límite); la cuota se controla con reservas antes de emitir la URL. Archivos de más de 100 MB se suben en partes (multipart) con reanudación.
storageKey = workspaceId/nodeId/version-aleatorio. Descarga siempre con URL prefirmada de 60 s tras resolveAccess, con Content-Disposition: attachment salvo PDF e imágenes en vista previa.
Borrar de la papelera elimina también los objetos en S3 (job en segundo plano).

11.1 Espacios (estado a cierre del Módulo 3)
Space: isPrivate, isConfidential (implica privado; CHECK en la base), departmentId, departmentLevel (EDIT|VIEW) e includeSubareas (por defecto false). Lista paginada por cursor en el servidor, con filtros (todos, mis departamentos, favoritos, privados), orden (nombre, departamento, fecha), favoritos y recientes por persona (SpaceUserState: GET /spaces/recent, PUT /spaces/:id/favorite, POST /spaces/:id/visit). Cada espacio devuelve su nivel y el motivo del acceso ("Jefe de Finanzas (área superior)", "Miembro de Contabilidad · incluye subáreas"). Las reglas de acceso están en acceso-a-contenido.md (8.2). Miembros del espacio: GET/PUT /spaces/:id/members, DELETE /spaces/:id/members/:permissionId.

11.2 Nodos y mover
GET /spaces/:id/nodes (paginado, cursor), POST /spaces/:id/folders, GET/PATCH/DELETE /nodes/:id, POST /nodes/:id/move. Mover: a otra carpeta o a la raíz, del mismo espacio o de otro donde se pueda editar (EDIT en origen y destino); rechaza ciclos (400) y valida la profundidad máxima. Conflicto de nombre con onConflict = FAIL (409, por defecto), REPLACE (el existente va a la papelera) o KEEP_BOTH (nombre numerado). La interfaz lo usa desde el diálogo "Mover a…", arrastrar y soltar y cortar/pegar, con "Deshacer". Cada carpeta lista su tamaño recursivo y quién la modificó.

11.3 Descargas en ZIP
POST /spaces/:id/download-zip planifica la selección con los permisos de quien pide (solo entra lo que ve). Hasta 500 MB: devuelve una URL con token de un solo uso (DownloadToken, hash, 2 minutos) y el backend transmite el ZIP en flujo; al canjear se vuelven a resolver los permisos. Más grande: se genera en segundo plano (worker), se guarda en el bucket de sistema 7 días (ZipExport, no cuenta para la cuota) y se avisa por email con un enlace temporal.

11.4 Importar ZIP
POST /spaces/:id/import-plan y POST /files/:id/import-zip (job en segundo plano; estado en GET /imports/:id). Un ZIP con una sola carpeta en la raíz se importa sin esa carpeta. Límites y protección contra bombas ZIP en adopcion.md.

11.5 Papelera
GET /spaces/:id/trash, DELETE /nodes/:id (a la papelera), POST /nodes/:id/restore, POST /nodes/:id/purge (borra también los objetos de S3 en segundo plano).
