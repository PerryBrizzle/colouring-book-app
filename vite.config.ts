import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * After a build, tells the service worker exactly which files make up the app
 * so it can store them all for offline use, and gives each build its own
 * cache name so an updated app replaces the old copy.
 */
function offlineManifest(): Plugin {
  let outDir = 'dist';
  return {
    name: 'offline-manifest',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const files: string[] = [];
      const walk = (dir: string, prefix: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory()) walk(path.join(dir, entry.name), `${prefix}${entry.name}/`);
          else if (entry.name !== 'sw.js') files.push(`${prefix}${entry.name}`);
        }
      };
      walk(outDir, './');
      const swPath = path.join(outDir, 'sw.js');
      const sw = readFileSync(swPath, 'utf8')
        .replaceAll('__BUILD__', Date.now().toString(36))
        .replaceAll('__ASSETS__', JSON.stringify(['./', ...files]));
      writeFileSync(swPath, sw);
    },
  };
}

// Shown at the bottom of the library so it's easy to tell which build a phone is running.
const version = new Date().toISOString().slice(0, 19).replace('T', ' ');

export default defineConfig({
  plugins: [react(), offlineManifest()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  // Relative paths so the built app works from any folder on a static host.
  base: './',
  worker: { format: 'es' },
});
