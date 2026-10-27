// Textos de Seguridad, de las páginas legales y de la portada de idiomas, en español neutro.
import { REPO_URL, SITE } from "../../config/site.ts";
import type { LegalPage } from "../types.ts";

const privacy: LegalPage = {
  title: "Política de privacidad",
  description: "Qué datos trata esta web y quién es responsable de los datos de cada instalación.",
  sections: [
    {
      heading: "Esta web",
      paragraphs: [
        `${SITE.domain} es la web informativa de ${SITE.name}, de ${SITE.owner}, su titular y responsable del tratamiento. No tiene cuentas ni formularios: no recoge datos personales, salvo los que nos envíes por email (por ejemplo, al consultar por un plugin), que usamos solo para responderte. La analítica, si la hay, es sin cookies y sin datos personales.`,
      ],
    },
    {
      heading: `Las instalaciones de ${SITE.name}`,
      paragraphs: [
        `${SITE.name} se instala en el servidor de cada empresa. Los datos de cada instalación (cuentas, documentos, registros) los trata la empresa que la opera, que es la responsable del tratamiento: no pasan por nuestros servidores ni tenemos acceso a ellos. Las consultas de privacidad sobre esos datos se dirigen a esa empresa.`,
      ],
    },
    {
      heading: "Licencias de plugins",
      paragraphs: [
        "Las licencias de los plugins se verifican sin conexión: el software no nos envía datos de uso. Al contratar un plugin tratamos los datos de facturación y contacto de la empresa cliente. [BASE LEGAL Y PLAZOS]",
      ],
    },
    {
      heading: "Tus derechos",
      paragraphs: [
        "Puedes pedir acceso, rectificación o supresión de los datos que nos hayas enviado. Marco aplicable: RGPD (UE) y Ley 25.326 (Argentina).",
      ],
    },
    { heading: "Contacto", paragraphs: ["contacto@spiderjad.com"] },
  ],
};

const terms: LegalPage = {
  title: "Licencia y términos",
  description: "Licencia del software, plugins comerciales y uso de esta web.",
  sections: [
    {
      heading: "El software",
      paragraphs: [
        [
          `${SITE.name} es software libre bajo la `,
          {
            text: "GNU Affero General Public License v3.0",
            href: "https://www.gnu.org/licenses/agpl-3.0.html",
          },
          ". Puedes usarlo, estudiarlo, modificarlo y distribuirlo según esa licencia; si ofreces una versión modificada a otras personas a través de una red, tienes que ofrecerles también su código fuente. El texto completo está en el ",
          { text: "repositorio", href: `${REPO_URL}/blob/main/LICENSE` },
          ".",
        ],
        "Se entrega «tal cual», sin garantías, en los términos de la licencia. Cada instalación la opera quien la instala, que es responsable de sus datos, su seguridad y sus copias.",
      ],
    },
    {
      heading: "Plugins comerciales",
      paragraphs: [
        "Los plugins comerciales no son parte del software libre: se rigen por su propio contrato de licencia, que se firma al contratarlos. [CONDICIONES DE LOS PLUGINS: PRECIO, DURACIÓN, RENOVACIÓN, SOPORTE Y LEY APLICABLE]",
      ],
    },
    {
      heading: "Marca",
      paragraphs: [
        `El nombre y el logo de ${SITE.name} identifican al proyecto. Una versión modificada que se distribuya o se ofrezca como servicio no puede presentarse como la oficial. [POLÍTICA DE MARCA]`,
      ],
    },
    {
      heading: "Esta web",
      paragraphs: [
        `${SITE.domain} es la web informativa del proyecto, de ${SITE.owner}. Su contenido se ofrece a título informativo. [LEY APLICABLE Y JURISDICCIÓN]`,
      ],
    },
  ],
};

const cookies: LegalPage = {
  title: "Política de cookies",
  description: "Qué cookies usa la web.",
  sections: [
    {
      heading: "",
      paragraphs: [
        `La web pública de ${SITE.name} solo usa almacenamiento esencial: guarda en tu navegador la preferencia de tema claro u oscuro y el idioma que elegiste. No usa cookies de seguimiento ni de publicidad, por eso no muestra un banner de consentimiento.`,
        "Si en el futuro se incorporan cookies no esenciales, esta política se actualizará y se pedirá tu consentimiento antes de usarlas.",
      ],
    },
  ],
};

export const pages = {
  security: {
    title: "Seguridad",
    description: `Cómo protege ${SITE.name} la información de tu empresa y qué conviene cuidar en tu instalación.`,
    eyebrow: "Seguridad",
    heading: "Tu documentación interna, protegida",
    intro: `${SITE.name} corre en tu servidor. Esto es lo que hace el software para cuidar la información de tu empresa, y lo que te toca a ti.`,
    blocks: [
      {
        icon: "globe",
        title: "En tu servidor",
        text: "La base de datos, los archivos y las copias quedan en tu infraestructura, en el país y con el proveedor que elijas. Nada pasa por nuestros servidores.",
      },
      {
        icon: "shield",
        title: "Aislamiento entre empresas",
        text: "Cada consulta a la base de datos se limita a la empresa de la persona que la hace, y una prueba automática verifica que una empresa nunca vea datos de otra.",
      },
      {
        icon: "users",
        title: "Permisos que se explican",
        text: "El acceso se da a departamentos y roles. En cada carpeta, archivo y página puedes ver quién accede y por qué. Los permisos se validan siempre en el servidor.",
      },
      {
        icon: "lock",
        title: "Cuentas protegidas",
        text: "Contraseñas con Argon2, verificación en dos pasos con códigos de recuperación, sesiones revocables, avisos de inicio de sesión y límites de intentos.",
      },
      {
        icon: "file-check",
        title: "Auditoría",
        text: "Registro inalterable de lo que pasa en la empresa: accesos, cambios de permisos, aprobaciones y lecturas, exportable para una auditoría.",
      },
      {
        icon: "book",
        title: "Código abierto",
        text: "Puedes leer y auditar todo el código. Los secretos de cada instalación (2FA, SMTP propio) se cifran con claves que solo tiene tu servidor.",
      },
    ],
    yourPartTitle: "Lo que te toca a ti",
    yourPart: [
      "HTTPS (el perfil https lo configura solo con un dominio)",
      "Actualizar a la última versión",
      "Copias de seguridad diarias fuera del servidor y probar la restauración",
      "Firewall con solo los puertos 80 y 443 abiertos (y SSH con clave)",
      "Guardar el archivo .env en un lugar seguro",
    ],
    dataNote:
      "Si activas a Bian, los fragmentos de documentos de cada consulta se envían a la API de Anthropic con tu propia clave. Si usas Sentry, los eventos de error no llevan datos personales.",
    reportTitle: "Reportar una vulnerabilidad",
    report: [
      "No abras un issue público: sigue la ",
      { text: "política de seguridad", href: `${REPO_URL}/security/policy` },
      " del repositorio.",
    ],
  },
  legal: {
    eyebrow: "Legal",
    draft: "Borrador pendiente de revisión por un profesional. No es el texto legal definitivo.",
    privacy,
    terms,
    cookies,
  },
  chooser: {
    title: "Elige tu idioma",
    action: "Continuar en español",
  },
} as const;
