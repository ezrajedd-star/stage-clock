import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv, type Plugin} from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Dev only: serve POST /api/stage-report and /api/close-leg from the same handlers the Vercel Functions use.
// Reads ANTHROPIC_API_KEY / PARX_GITHUB_TOKEN from .env.local (server side; never exposed to the browser bundle).
const DEV_ROUTES: Record<string, { module: string; handler: string }> = {
  '/api/stage-report': { module: '/src/server/stageReport.ts', handler: 'handleStageReport' },
  '/api/close-leg': { module: '/src/server/closeLeg.ts', handler: 'handleCloseLeg' },
};

function stageReportApi(env: Record<string, string>): Plugin {
  return {
    name: 'stage-report-api',
    configureServer(server) {
      for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'PARX_GITHUB_TOKEN', 'PARX_GITHUB_REPO']) {
        if (env[key] && !process.env[key]) process.env[key] = env[key];
      }
      for (const [route, target] of Object.entries(DEV_ROUTES)) server.middlewares.use(route, async (req, res) => {
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
          const request = new Request(`http://localhost${req.originalUrl ?? req.url}`, {
            method: req.method,
            headers,
            body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
          });
          const mod = await server.ssrLoadModule(target.module);
          const response: Response = await mod[target.handler](request);
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (err) {
          console.error(err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'INTERNAL', message: 'Dev server error' }));
        }
      });
    },
  };
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [
      react(), 
      tailwindcss(),
      stageReportApi(env),
      VitePWA({
        registerType: 'autoUpdate',
        manifest: {
          name: 'Stage Clock by Ezra Decena',
          short_name: 'Stage Clock',
          description: 'Live rally stage times, class standings and results.',
          theme_color: '#090A0C',
          background_color: '#090A0C',
          display: 'standalone',
          icons: [
            { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
            { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
          ]
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}']
        }
      })
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
