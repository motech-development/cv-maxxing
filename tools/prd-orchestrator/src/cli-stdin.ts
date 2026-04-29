import type { Readable } from 'node:stream'

export type CliReadableStdin = Readable & {
  readonly isTTY?: boolean
  setEncoding: (encoding: BufferEncoding) => void
}

export const readCliStdin = async (stdin: CliReadableStdin): Promise<string> => {
  if (stdin.isTTY === true) {
    return ''
  }

  return await new Promise((resolve, reject) => {
    let content = ''

    stdin.setEncoding('utf8')
    stdin.on('data', (chunk: string) => {
      content += chunk
    })
    stdin.on('end', () => {
      resolve(content)
    })
    stdin.on('error', (error: Error) => {
      reject(error)
    })
  })
}
