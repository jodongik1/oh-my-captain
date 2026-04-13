import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    // Vite 빌드 결과를 plugin 리소스 디렉토리에 직접 출력
    outDir: '../../hosts/intellij/src/main/resources/webview',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  }
})
