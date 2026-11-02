const VARIANTS = String.raw`(?:[\w-]*(?:\[[^\]\s]*\])?:)*`
const PREFIX = String.raw`${VARIANTS}(?:bg|text|border|ring|divide|outline|fill|stroke|from|via|to|placeholder|decoration|accent|shadow)`
const LEGACY = String.raw`${PREFIX}-(?:ink|line|panel|side|fill|blue|red|amber|green)(?:-(?:2|3|soft))?(?:\/\d+)?`
const PALETTE = String.raw`${PREFIX}-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}(?:\/\d+)?`
const MONO = String.raw`${PREFIX}-(?:white|black)(?:\/\d+)?`
const HEX = String.raw`${PREFIX}-\[#[0-9a-fA-F]{3,8}\]`
// 前后必须是类名边界:空白、引号、反引号、`${`、`}` 或行首行尾
const RE = new RegExp(String.raw`(?<=^|[\s'"\`{}])(?:${HEX}|${PALETTE}|${MONO}|${LEGACY})(?=$|[\s'"\`}])`, 'gm')

export function findLegacyStyles(files: Record<string, string>): string[] {
  return Object.keys(files)
    .sort()
    .flatMap((path) => Array.from(files[path].matchAll(RE), (m) => `${path}: ${m[0]}`))
}
