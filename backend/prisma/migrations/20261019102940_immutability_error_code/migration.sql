-- El trigger de inmutabilidad usaba restrict_violation (clase 23), que Prisma informa como
-- violación de clave foránea y pierde el mensaje. Se usa el código por defecto de RAISE
-- (P0001), que llega con el texto "… es inmutable …".
CREATE OR REPLACE FUNCTION prolijo_reject_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% es inmutable: no se permite UPDATE', TG_TABLE_NAME;
END;
$$;
