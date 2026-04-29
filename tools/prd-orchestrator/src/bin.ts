#!/usr/bin/env node

import { runPrdOrchestratorCliAsync } from './cli.js'
import { readCliStdin } from './cli-stdin.js'

const stdin = await readCliStdin(process.stdin)
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
