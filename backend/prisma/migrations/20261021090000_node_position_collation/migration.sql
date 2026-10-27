-- Las posiciones fraccionales ordenan por código de carácter (dígitos, mayúsculas, minúsculas):
-- con el orden del idioma del servidor, "a" < "B" y las claves se desordenarían.
ALTER TABLE "Node" ALTER COLUMN "position" TYPE TEXT COLLATE "C";
