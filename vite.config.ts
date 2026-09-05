import { defineConfig } from 'vite';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const apiMiddleware = require('./server/apiMiddleware.cjs');

export default defineConfig({
  base: './',
  server: {
    port: 3000,
    open: true
  },
  plugins: [
    {
      name: 'sqlite-pos-api',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          apiMiddleware(req, res, next);
        });
      }
    }
  ]
});
