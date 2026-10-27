// Lo genera plugins.vite.ts al compilar: la parte de app de cada plugin instalado.
declare module "virtual:spiderfolio-plugins" {
  import type { FrontendPlugin } from "@spiderfolio/plugin-sdk/frontend";

  const plugins: readonly FrontendPlugin[];
  export default plugins;
}
