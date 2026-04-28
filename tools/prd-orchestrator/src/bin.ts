#!/usr/bin/env node

import { runPrdOrchestratorCliAsync } from './cli.js'

const stdin = await readStdin()
const result = await runPrdOrchestratorCliAsync({
  arguments_: process.argv.slice(2),
  stdin,
})

if (result.stdout.length > 0) {
  process.stdout.write(result.stdout)
}

if (result.stderr.length > 0) {
  process.stderr.write(result.stderr)
}

process.exitCode = result.exitCode

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let content = ''

    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk: string) => {
      content += chunk
    })
    process.stdin.on('end', () => {
      resolve(content)
    })
    process.stdin.on('error', (error: Error) => {
      reject(error)
    })
  })
}
