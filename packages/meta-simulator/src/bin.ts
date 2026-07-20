#!/usr/bin/env node
// Entrypoint del binario. La lógica vive en `cli.ts` para poder testearla sin
// arrancar un proceso.
import { run } from './cli.js'

await run()
