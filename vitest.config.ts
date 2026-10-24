import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

export default mergeConfig(viteConfig, defineConfig({
  // Keep nested worktrees and disposable cache experiments out of this suite.
  test: { include: ['tests/**/*.{test,spec}.?(c|m)[jt]s?(x)'] },
}))
