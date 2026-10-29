import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { isOverviewKey } from "@/features/home/home-api";
import { ApiError } from "./api";

/** La política de 2FA del workspace cambió y la persona todavía no la tiene: la app vuelve a pedir la cuenta. */
export const MFA_SETUP_EVENT = "spiderfolio:mfa-setup-required";

/** The company only lets this person in through its directory: the app asks them to sign in with it. */
export const DIRECTORY_SIGN_IN_EVENT = "spiderfolio:directory-sign-in-required";

const announceMfaSetup = (error: unknown) => {
  if (error instanceof ApiError && error.code === "MFA_SETUP_REQUIRED") {
    window.dispatchEvent(new Event(MFA_SETUP_EVENT));
  }
  if (error instanceof ApiError && error.code === "DIRECTORY_SIGN_IN_REQUIRED") {
    window.dispatchEvent(new Event(DIRECTORY_SIGN_IN_EVENT));
  }
};

/** Errores 4xx no se reintentan (no van a cambiar); errores de red y 5xx, hasta 2 veces. */
export function createQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    // Tras cualquier cambio que sale bien (aprobar, leer, publicar, compartir…), el Inicio se vuelve
    // a pedir al instante: sus números dependen de casi todo lo que se hace en la app.
    queryCache: new QueryCache({ onError: announceMfaSetup }),
    mutationCache: new MutationCache({
      onError: announceMfaSetup,
      onSuccess: () => {
        void client.invalidateQueries({ predicate: (query) => isOverviewKey(query.queryKey) });
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failureCount, error) =>
          !(error instanceof ApiError && error.status < 500) && failureCount < 2,
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false },
    },
  });
  return client;
}
