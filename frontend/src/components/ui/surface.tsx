// Which spider-ui system a component is drawn with (docs/spec/diseno.md 10.1): the panel (v-*) everywhere,
// or the access screens (auth-*) inside AuthLayout. The same Button, Input, FormField… pick their classes
// from it, so an access screen never mixes the two systems.
import { createContext, useContext, type ReactNode } from "react";

const AuthSurfaceContext = createContext(false);

export function AuthSurface({ children }: { children: ReactNode }) {
  return <AuthSurfaceContext.Provider value>{children}</AuthSurfaceContext.Provider>;
}

/** True inside an access screen (login, registration, password, invitation, external portals). */
export function useAuthSurface(): boolean {
  return useContext(AuthSurfaceContext);
}
