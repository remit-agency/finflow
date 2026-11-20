// Local check of real MT940 statement files (S14). Reads every file in a folder (argv[2], default .local/mt940-samples), decodes
// it as the browser does, parses it and prints the report of lib/check-mt940.ts. Writes nothing; prints no full account number.
//   npx tsx scripts/check-mt940.ts [folder]
// Exit code: 0 the folder was read, 2 the folder is missing.
import fs from 'node:fs'
import path from 'node:path'
import { decodeStatementBytes } from '@/lib/domain/import/decode'
import { parseMt940 } from '@/lib/domain/import/mt940'
import { reportLines } from './lib/check-mt940'

const folder = path.resolve(process.argv[2] ?? '.local/mt940-samples')

if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
  console.error(`No folder: ${folder}`)
  process.exit(2)
}

const files = fs
  .readdirSync(folder)
  .filter((name) => fs.statSync(path.join(folder, name)).isFile())
  .sort()

if (files.length === 0) console.log(`No files in ${folder}`)

for (const name of files) {
  const { text, encoding } = decodeStatementBytes(new Uint8Array(fs.readFileSync(path.join(folder, name))))
  const result = parseMt940(text)
  console.log(reportLines({ name, encoding, result }).join('\n'))
  console.log('')
}
