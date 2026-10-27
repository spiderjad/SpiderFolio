-- Renombrado del producto (Prolijo → SpiderFolio): la función de los triggers de inmutabilidad
-- pasa a llamarse spiderfolio_reject_update. Los triggers la referencian por OID, así que
-- siguen funcionando. Las migraciones anteriores conservan su contenido original (una
-- migración aplicada no se edita).
ALTER FUNCTION prolijo_reject_update() RENAME TO spiderfolio_reject_update;
