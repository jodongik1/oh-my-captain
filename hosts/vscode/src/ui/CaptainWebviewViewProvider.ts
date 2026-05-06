// "Oh My Captain" 사이드바 webview view provider.
// IntelliJ 의 CaptainToolWindowFactory 와 동치.
//
// 부팅 시퀀스:
// 1. resolveWebviewView 가 webview 인스턴스를 받음.
// 2. localResourceRoots 로 resources/webview/ 와 resources/core/ 접근 허용.
// 3. window.__omcBridge shim 을 inject — webview 패키지(@omc/webview) 한 줄 변경 없이 동작.
// 4. Core 부팅(CoreProcessManager.start) → bridge.connectCore.
// 5. dev 모드면 Vite dev server URL, 아니면 빌드된 index.html 자산 로드.

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as vscode from 'vscode'
import { CoreProcessManager } from '../core/CoreProcessManager.js'
import { WebviewBridgeManager } from '../bridge/WebviewBridgeManager.js'
import { loggerFor } from '../logging/logger.js'

const log = loggerFor('CaptainWebviewViewProvider')

export class CaptainWebviewViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'omcView'

  /** 가시화·revealView 호출 위해 외부에 노출. */
  private currentView: vscode.WebviewView | null = null
  private bridge: WebviewBridgeManager | null = null

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly extensionPath: string,
    private readonly coreManager: CoreProcessManager,
    private readonly extensionMode: vscode.ExtensionMode,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.currentView = view
    const webview = view.webview

    const webviewRoot = vscode.Uri.joinPath(this.extensionUri, 'resources', 'webview')
    const isDev = this.extensionMode === vscode.ExtensionMode.Development || process.env.OMC_DEV === '1'
    webview.options = {
      enableScripts: true,
      // Vite 산출물 + 폰트/이미지 등 정적 자원에만 접근 허용.
      localResourceRoots: [webviewRoot],
      // dev 모드: webview iframe 안에서 localhost:5173 직접 접근이 막히므로 (VS Code 1.85+ sandbox)
      // portMapping 으로 동일 origin 프록시. webviewPort=5173 요청 → extension host 의 5173 으로 라우팅.
      portMapping: isDev
        ? [{ webviewPort: 5173, extensionHostPort: 5173 }]
        : [],
    }

    const bridge = new WebviewBridgeManager(webview)
    this.bridge = bridge

    // Webview → Core 연결: extension host 측에서 Core 자식 프로세스를 spawn 하고 IPC 연결.
    // EDT 동치 차단은 없지만 IO 가 많으므로 Promise/setImmediate 로 비동기 진입.
    setImmediate(() => {
      try {
        log.info('Core boot sequence start')
        const proc = this.coreManager.start()
        const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ''
        bridge.connectCore(proc, projectRoot)
        log.info('Core boot done — IPC handshake sent')
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        log.error(`Core boot failed: ${msg}`, e)
        bridge.postError(`Core 시작 실패: ${msg}`)
      }
    })

    webview.html = this.renderHtml(webview)

    view.onDidDispose(() => {
      log.info('Webview view disposed')
      this.bridge?.dispose()
      this.bridge = null
      this.currentView = null
    })
  }

  /** 코드 액션 등에서 사이드바를 강제로 열고 싶을 때 호출. */
  async revealView(): Promise<void> {
    if (this.currentView) {
      this.currentView.show?.(true)
      return
    }
    await vscode.commands.executeCommand('omcView.focus')
  }

  /** 코드 액션이 직접 sendToCore 할 수 있도록 dispatcher 인터페이스 노출. */
  sendToCore(message: import('../ipc/IpcChannel.js').IpcMessage): void {
    if (!this.bridge) {
      log.warn('sendToCore called before view resolved — message dropped')
      return
    }
    this.bridge.sendToCore(message)
  }

  /** 빌드된 webview index.html 을 로드하면서 자원 URL 을 asWebviewUri 로 치환하고 shim 주입. */
  private renderHtml(webview: vscode.Webview): string {
    // dev 판정: VS Code 가 알려주는 extensionMode 우선. OMC_DEV 환경변수는 보조.
    // (`code` CLI 가 기존 인스턴스에 명령 위임할 때 부모 환경변수를 안 넘기는 케이스 회피)
    const isDev = this.extensionMode === vscode.ExtensionMode.Development || process.env.OMC_DEV === '1'
    const viteOrigin = 'http://localhost:5173'
    log.info(`renderHtml: mode=${vscode.ExtensionMode[this.extensionMode]}, isDev=${isDev}`)

    // CSP — VS Code webview 는 strict-csp 권장. dev 모드에서는 Vite origin 도 허용.
    const cspSources = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} data: blob:` + (isDev ? ` ${viteOrigin}` : ''),
      `style-src ${webview.cspSource} 'unsafe-inline'` + (isDev ? ` ${viteOrigin}` : ''),
      `font-src ${webview.cspSource} data:` + (isDev ? ` ${viteOrigin}` : ''),
      `script-src ${webview.cspSource} 'unsafe-inline'` + (isDev ? ` ${viteOrigin} 'unsafe-eval'` : ''),
      `connect-src ${webview.cspSource} data:` + (isDev ? ` ${viteOrigin} ws://localhost:5173` : ''),
    ].join('; ')

    const bridgeShim = this.buildBridgeShim()

    if (isDev) {
      // Vite dev server 가 띄운 main.tsx 를 그대로 import — HMR 동작.
      // @vitejs/plugin-react preamble 을 수동 주입 — 평소엔 vite 가 transformIndexHtml 단계에서
      // 자동 박지만, 우리는 vite 의 HTML transform 을 거치지 않으므로 직접 박는다.
      const reactRefreshPreamble = `
import RefreshRuntime from "${viteOrigin}/@react-refresh"
RefreshRuntime.injectIntoGlobalHook(window)
window.$RefreshReg$ = () => {}
window.$RefreshSig$ = () => (type) => type
window.__vite_plugin_react_preamble_installed__ = true
`
      return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${cspSources}">
    <meta name="viewport" content="width=device-width,initial-scale=1.0" />
    <title>Oh My Captain</title>
    <script>${bridgeShim}</script>
    <script type="module">${reactRefreshPreamble}</script>
    <script type="module" src="${viteOrigin}/@vite/client"></script>
    <script type="module" src="${viteOrigin}/src/main.tsx"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`
    }

    // 프로덕션: 빌드된 index.html 을 읽어 상대 자원경로를 asWebviewUri 로 치환.
    const indexHtmlPath = path.join(this.extensionPath, 'resources', 'webview', 'index.html')
    if (!fs.existsSync(indexHtmlPath)) {
      log.warn(`Webview index.html missing at ${indexHtmlPath}`)
      return `<!doctype html><html><head>
        <meta http-equiv="Content-Security-Policy" content="${cspSources}">
      </head><body style="font-family:sans-serif;padding:1rem;color:#ccc;background:#1e1e1e;">
        <h2>Webview 자산 없음</h2>
        <pre>resources/webview/index.html 누락
"./build.sh vscode" 또는 "./build.sh vscode:dev" 로 webview 번들을 빌드하세요.

확인된 경로: ${indexHtmlPath}</pre>
      </body></html>`
    }
    let html = fs.readFileSync(indexHtmlPath, 'utf8')
    const webviewRoot = vscode.Uri.joinPath(this.extensionUri, 'resources', 'webview')

    // Vite 가 만들어내는 형태: src="/assets/foo.js", href="/assets/bar.css" — 모두 로컬 파일.
    html = html.replace(/(src|href)="(\/[^"]+)"/g, (_, attr, p) => {
      const rel = p.replace(/^\//, '')
      const fileUri = vscode.Uri.joinPath(webviewRoot, rel)
      return `${attr}="${webview.asWebviewUri(fileUri)}"`
    })

    // CSP 메타 + bridge shim 주입.
    const headInjection =
      `<meta http-equiv="Content-Security-Policy" content="${cspSources}">\n` +
      `<script>${bridgeShim}</script>\n`
    html = html.replace(/<head>/i, `<head>\n${headInjection}`)
    return html
  }

  /**
   * window.__omcBridge shim — IntelliJ JBCEFBridgeManager.injectBridgeScript 와 동등 인터페이스.
   *
   * Webview 패키지 (@omc/webview) 의 jcef.ts 가 이 객체에만 의존하므로 한 줄도 안 고치고 재사용.
   * - send(msg) : extension host 로 postMessage
   * - onMessage : Kotlin 측은 JSON string 으로 호출했었음 → VS Code 도 동일하게 stringify 해서 전달
   */
  private buildBridgeShim(): string {
    return `
(function() {
  const vscode = acquireVsCodeApi();
  const bridge = {
    onMessage: null,
    send: function(msg) { vscode.postMessage(msg); }
  };
  window.__omcBridge = bridge;
  window.addEventListener('message', function(ev) {
    if (bridge.onMessage) {
      try { bridge.onMessage(JSON.stringify(ev.data)); }
      catch (e) { console.error('[bridge:onMessage]', e); }
    }
  });
})();
`
  }
}
