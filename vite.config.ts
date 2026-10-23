import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { previewSavePlugin } from './scripts/track/preview-save-plugin.ts'

// https://vite.dev/config/
export default defineConfig({
  // Supabase's Vercel integration names its browser-safe vars NEXT_PUBLIC_SUPABASE_*; expose those too (docs/ACCOUNTS.md).
  envPrefix: ['VITE_', 'NEXT_PUBLIC_SUPABASE_'],
  plugins: [react(), ...(process.env.CAPTURE_TRACK_PREVIEWS === '1' ? [previewSavePlugin()] : [])],
})
