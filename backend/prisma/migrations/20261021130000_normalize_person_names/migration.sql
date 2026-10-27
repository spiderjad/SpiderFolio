-- Normaliza una sola vez los nombres de personas que ya existen, con la misma regla que
-- backend/src/lib/person-name.ts (normalizePersonName): se recortan y unifican los espacios; si el
-- nombre está todo en minúsculas o todo en mayúsculas, cada palabra lleva mayúscula inicial y las
-- partículas (de, del, la, las, los, y, i, da, van, von) quedan en minúscula salvo al inicio; si
-- mezcla mayúsculas y minúsculas se respeta tal cual.
CREATE FUNCTION pg_temp.normalize_person_name(input text) RETURNS text AS $$
DECLARE
  spaced text := btrim(regexp_replace(input, '\s+', ' ', 'g'));
  words text[];
  result text[] := ARRAY[]::text[];
  word text;
  idx int := 0;
BEGIN
  -- Mayúsculas y minúsculas mezcladas: se respeta.
  IF spaced <> lower(spaced) AND spaced <> upper(spaced) THEN
    RETURN spaced;
  END IF;
  words := string_to_array(lower(spaced), ' ');
  FOREACH word IN ARRAY words LOOP
    idx := idx + 1;
    IF idx > 1 AND word = ANY (ARRAY['de', 'del', 'la', 'las', 'los', 'y', 'i', 'da', 'van', 'von']) THEN
      result := result || word;
    ELSE
      result := result || initcap(word);
    END IF;
  END LOOP;
  RETURN array_to_string(result, ' ');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

UPDATE "User"
SET "name" = pg_temp.normalize_person_name("name")
WHERE "name" <> pg_temp.normalize_person_name("name")
  AND btrim(regexp_replace("name", '\s+', ' ', 'g')) <> '';
