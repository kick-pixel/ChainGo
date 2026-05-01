import { Buffer } from 'buffer'
import process from 'process'

const globalScope = globalThis as typeof globalThis & {
  Buffer?: typeof Buffer
  process?: typeof process
}

globalScope.Buffer ??= Buffer
globalScope.process ??= process
globalScope.process.env ??= {}
