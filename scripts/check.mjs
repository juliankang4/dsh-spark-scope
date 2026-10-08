import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const files = [
  ...readdirSync('.'),
  ...['src', 'scripts', 'test']
    .filter(existsSync)
    .flatMap((dir) => readdirSync(dir, { recursive: true }).map((file) => join(dir, file))),
].filter((file) => /\.(?:[cm]?[jt]s|[jt]sx)$/.test(file))

for (const file of files) {
  for (const [index, line] of readFileSync(file, 'utf8').split('\n').entries()) {
    const comment =
      /(?:\/\/|\/\*|\*|^)\s*(@ts-(?:ignore|nocheck|expect-error)|biome-ignore(?:-all|-start|-end)?|eslint-disable(?:-next-line|-line)?)\b(.*)/.exec(
        line,
      )
    if (comment === null) continue
    const [, directive, text] = comment
    const reason = text.replace(/\*\/.*$/, '').trim()
    if (directive === '@ts-expect-error' && /^:\s*\S/.test(reason)) continue
    if (directive === 'biome-ignore' && /^lint\/\w+\/\w+:\s*\S/.test(reason)) continue
    throw new Error(`${file}:${index + 1}: use a rule-specific inline suppression or @ts-expect-error with a reason`)
  }
  if (/\.[cm]?js$/.test(file)) {
    const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' })
    if (result.error !== undefined) throw result.error
    if (result.status !== 0) process.exit(result.status ?? 1)
  }
}
