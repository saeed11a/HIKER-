import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

// The `@/…` import alias is declared here (and mirrored in jsconfig.json for the
// editor). It used to come from the Base44 Vite plugin, which the app no longer
// carries — without it every `@/` import fails to resolve at build time.
const srcAlias = { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) };

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [srcAlias],
  },
});
