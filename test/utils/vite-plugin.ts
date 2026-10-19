import { createServer, type InlineConfig, type Plugin, type ViteDevServer } from 'vite';

/** Register middleware through Vite's real plugin context, retaining only the plugin's routes. */
export async function createPluginMiddleware(
  plugin: Plugin,
  config: InlineConfig,
): Promise<ViteDevServer> {
  const configure = plugin.configureServer;
  if (typeof configure !== 'function') throw new Error(`${plugin.name} must configure middleware`);
  let routes: ViteDevServer['middlewares']['stack'] = [];
  const server = await createServer({
    ...config,
    configFile: false,
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [
      {
        name: plugin.name,
        async configureServer(server) {
          const before = server.middlewares.stack.length;
          const after = await configure.call(this, server);
          routes = server.middlewares.stack.slice(before);
          return after;
        },
      },
    ],
  });
  server.middlewares.stack.splice(0, server.middlewares.stack.length, ...routes);
  return server;
}
