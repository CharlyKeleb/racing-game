import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { previewSavePlugin } from './scripts/track/preview-save-plugin.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), ...(process.env.CAPTURE_TRACK_PREVIEWS === '1' ? [previewSavePlugin()] : [])],
})
