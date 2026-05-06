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
    // VS Code webview iframe(`vscode-webview://...` origin) 에서 module import 시
    // service worker 가 CORS 검사를 하므로 dev server 응답에 Access-Control-Allow-Origin 필요.
    // Vite 6 의 보안 강화로 default 가 localhost-only 라서 명시적으로 허용.
    cors: true,
  }
})
