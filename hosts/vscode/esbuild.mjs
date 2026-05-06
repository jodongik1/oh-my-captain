// VS Code extension host 코드를 단일 파일로 번들한다.
// vscode 모듈은 런타임에 호스트가 주입하므로 external 처리.
import { build, context } from 'esbuild'

const isWatch = process.argv.includes('--watch')

const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'out/extension.js',
  external: ['vscode'],
  sourcemap: true,
  logLevel: 'info',
}

if (isWatch) {
  const ctx = await context(options)
  await ctx.watch()
  console.log('Watching extension src...')
} else {
  await build(options)
  console.log('Extension bundled to out/extension.js')
}
