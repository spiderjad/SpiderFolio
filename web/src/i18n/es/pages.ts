// Textos de Seguridad, de las páginas legales y de la portada de idiomas, en español neutro.
import { REPO_URL, SITE } from "../../config/site.ts";
import type { LegalPage } from "../types.ts";

const mail = (address: string) => ({ text: address, href: `mailto:${address}` });

const legalNotice: LegalPage = {
  title: "Aviso legal",
  description: `Titular de ${SITE.domain} y condiciones de esta web informativa.`,
  sections: [
    {
      heading: "Titular",
      paragraphs: [
        `Esta web (${SITE.domain}) es de ${SITE.owner}, titular del proyecto ${SITE.name}.`,
        ["Contacto: ", mail(SITE.contactEmail), "."],
      ],
    },
    {
      heading: "Objeto",
      paragraphs: [
        `Es la web informativa de ${SITE.name}, un proyecto de código abierto: explica qué hace el software, cómo instalarlo y qué plugins y servicios opcionales existen. No tiene tienda, cuentas de usuario ni formularios.`,
      ],
    },
    {
      heading: "Propiedad intelectual",
      paragraphs: [
        [
          `El código de ${SITE.name} se publica bajo la `,
          { text: "licencia AGPLv3", href: "https://www.gnu.org/licenses/agpl-3.0.html" },
          `. Los textos, el diseño y la marca ${SITE.name} de esta web son del titular, salvo que se indique otra cosa.`,
        ],
      ],
    },
    {
      heading: "Responsabilidad",
      paragraphs: [
        "El contenido se ofrece a título informativo y se revisa con cuidado, pero puede contener errores u omisiones. Los enlaces a sitios de terceros (por ejemplo, GitHub) se ofrecen por comodidad: el titular no responde de su contenido.",
      ],
    },
    {
      heading: "Legislación aplicable",
      paragraphs: ["Esta web se rige por la legislación española."],
    },
  ],
};

const privacy: LegalPage = {
  title: "Política de privacidad",
  description:
    "Qué datos trata esta web, para qué, durante cuánto tiempo y cómo ejercer tus derechos.",
  sections: [
    {
      heading: "Responsable",
      paragraphs: [
        [
          "El responsable del tratamiento es ",
          SITE.owner,
          ". Contacto: ",
          mail(SITE.contactEmail),
          ".",
        ],
      ],
    },
    {
      heading: "Qué datos tratamos",
      paragraphs: [
        [
          "Emails que nos envías a ",
          mail(SITE.contactEmail),
          " o a ",
          mail(SITE.securityEmail),
          ": tu dirección, tu nombre y lo que escribas. Los usamos solo para responderte y los conservamos hasta resolver tu consulta. Base legal: tu consentimiento al escribirnos y nuestro interés legítimo en atender tu consulta.",
        ],
        "Registros técnicos del hosting: el proveedor que aloja la web (Hostinger) registra datos de cada visita, como la dirección IP, la fecha y la página pedida, para la seguridad y el funcionamiento del servicio. Los conserva según su propia política. Base legal: interés legítimo en mantener la web segura.",
        "La web no tiene formularios, cuentas ni analítica, y no usa cookies.",
      ],
    },
    {
      heading: `Las instalaciones de ${SITE.name}`,
      paragraphs: [
        `${SITE.name} autoinstalado no envía datos al titular. Cada empresa que lo instala en su servidor es la responsable de los datos que trata con él (cuentas, documentos y registros), y las consultas de privacidad sobre esos datos se dirigen a esa empresa.`,
        "Si una empresa activa a Bian, el asistente, los fragmentos de documentos de cada consulta se envían a Anthropic con la clave de esa empresa: ese envío también es responsabilidad de la empresa.",
      ],
    },
    {
      heading: "Tus derechos",
      paragraphs: [
        [
          "Puedes ejercer tus derechos de acceso, rectificación, supresión, oposición, limitación del tratamiento y portabilidad escribiendo a ",
          mail(SITE.contactEmail),
          ". Si crees que no atendimos bien tu solicitud, puedes presentar una reclamación ante la ",
          { text: "Agencia Española de Protección de Datos", href: "https://www.aepd.es" },
          ".",
        ],
      ],
    },
  ],
};

const terms: LegalPage = {
  title: "Términos de uso",
  description: "Condiciones de uso de esta web, licencia del software y marca.",
  sections: [
    {
      heading: "Uso de la web",
      paragraphs: [
        `${SITE.domain} es una web informativa. Puedes consultarla libremente; no está permitido usarla para fines ilícitos ni intentar dañar su funcionamiento.`,
      ],
    },
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
        "Se entrega «tal cual», sin garantías de ningún tipo, en los términos de la licencia. Cada instalación la opera quien la instala, que es responsable de sus datos, su seguridad y sus copias.",
      ],
    },
    {
      heading: "Marca",
      paragraphs: [
        `El nombre y el logo de ${SITE.name} son del titular e identifican al proyecto. La licencia del software no da derecho a usarlos: una versión modificada que se distribuya o se ofrezca como servicio no puede presentarse como la oficial.`,
      ],
    },
    {
      heading: "Plugins y servicios",
      paragraphs: [
        "Los plugins comerciales y los servicios no forman parte del software libre: se rigen por sus propias condiciones, que se acuerdan al contratarlos.",
      ],
    },
    {
      heading: "Legislación aplicable",
      paragraphs: ["Estos términos se rigen por la legislación española."],
    },
  ],
};

const cookies: LegalPage = {
  title: "Política de cookies",
  description: "Esta web no usa cookies.",
  sections: [
    {
      heading: "",
      paragraphs: [
        `La web de ${SITE.name} no usa cookies: ni propias ni de terceros, ni de análisis ni de publicidad. Por eso no muestra un banner de consentimiento.`,
        "Solo guarda en tu navegador (almacenamiento local) dos preferencias que eliges tú: el tema claro u oscuro y el idioma. No sirven para identificarte ni salen de tu navegador, y están exentas de consentimiento porque solo recuerdan lo que pediste. Puedes borrarlas cuando quieras desde la configuración del navegador.",
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
    updated: (date: string) => `Última actualización: ${date}`,
    legalNotice,
    privacy,
    terms,
    cookies,
  },
  chooser: {
    title: "Elige tu idioma",
    action: "Continuar en español",
  },
} as const;
