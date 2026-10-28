# Capturas

Las capturas del README y de la web pública están en `web/public/capturas/<es|en>/<nombre>-<light|dark>.webp`
y se generan con `web/scripts/capturas.ts`, con la empresa demo del seed (`npm run db:seed`): nunca con
datos reales de personas ni de empresas.

El README usa las versiones claras de `explorador`, `documento-controlado`, `accesos` y `bian`,
con rutas relativas a esos archivos (sin parámetros como `?v=`). `node scripts/check-readme-links.ts`
(también en el CI) falla si una imagen o enlace local de los README apunta a un archivo inexistente.
