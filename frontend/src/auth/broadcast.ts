// Aviso entre pestañas (CLAUDE.md, sección 7.3): al cerrar sesión en una, las demás limpian
// todo y vuelven al login; al iniciar sesión en una, las demás retoman la sesión.

export type AuthMessage = { type: "logout" } | { type: "login" };

const CHANNEL = "spiderfolio-auth";

export function createAuthChannel(onMessage: (message: AuthMessage) => void) {
  if (typeof BroadcastChannel === "undefined") {
    return { post: () => undefined, close: () => undefined };
  }
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (event: MessageEvent<AuthMessage>) => {
    onMessage(event.data);
  };
  return {
    post: (message: AuthMessage) => {
      channel.postMessage(message);
    },
    close: () => {
      channel.close();
    },
  };
}
