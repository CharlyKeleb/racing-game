import { defineConfig } from 'vite'

// Bundle the shared physics source outside the backend's isolated NodeNext tsconfig.
// Backend packages remain external and come from server/package-lock.json.
export default defineConfig({
  publicDir: false,
  ssr: { noExternal: ['three', '@dimforge/rapier3d-compat'] },
  build: {
    ssr: 'scripts/multiplayer/staging-race-server.ts',
    outDir: 'dist-race',
    emptyOutDir: true,
    sourcemap: false,
    target: 'node22',
    rolldownOptions: {
      external: ['@colyseus/core', '@colyseus/ws-transport', '@supabase/supabase-js', 'express', 'express-rate-limit', 'jose'],
      output: { entryFileNames: 'server.mjs' },
    },
  },
})
