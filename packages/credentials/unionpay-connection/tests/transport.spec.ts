/** External HTTP validation rejects unsafe destinations and unbounded or malformed responses. */
import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { enterpriseRequest } from '../src/transport.ts'
import { enterpriseOrigin } from '../src/protocol.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function origin(respond: (response: ServerResponse) => void): Promise<string> {
  const server = createServer((_request, response) =>{  respond(response) })
  cleanups.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() =>{  resolve() })) })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Missing fixture address')
  return 'http://127.0.0.1:' + String(address.port)
}

describe('enterprise transport', () => {
  it('accepts explicit intranet HTTP and HTTPS origins, but no path or embedded credential', () => {
    expect(enterpriseOrigin('http://intranet.example:8443/')).toBe('http://intranet.example:8443')
    expect(enterpriseOrigin('https://enterprise.example')).toBe('https://enterprise.example')
    for (const value of ['file:///tmp', 'https://name:password@example.test', 'https://example.test/api', 'https://example.test/?token=secret', 'https://example.test/#secret']) {
      expect(() => enterpriseOrigin(value)).toThrow()
    }
  })

  it('does not disclose a server error body or follow its redirect', async () => {
    const endpoint = await origin((response) => { response.writeHead(302, { Location: 'http://elsewhere.invalid' }); response.end('private-server-error') })
    await expect(enterpriseRequest(endpoint, '/snapshot', {}, { requestTimeoutMs: 1000, maxResponseBytes: 1024 }, new AbortController().signal)).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('rejects an oversized body even without Content-Length', async () => {
    const endpoint = await origin((response) => { response.writeHead(200, { 'Content-Type': 'application/json' }); response.write('{"value":"'); response.end('x'.repeat(2000) + '"}') })
    await expect(enterpriseRequest(endpoint, '/snapshot', {}, { requestTimeoutMs: 1000, maxResponseBytes: 64 }, new AbortController().signal)).rejects.toMatchObject({ code: 'invalid-response' })
  })

  it('distinguishes a cancelled request from a malformed response', async () => {
    const endpoint = await origin((response) => { response.end('not json') })
    await expect(enterpriseRequest(endpoint, '/snapshot', {}, { requestTimeoutMs: 1000, maxResponseBytes: 64 }, new AbortController().signal)).rejects.toMatchObject({ code: 'invalid-response' })
    const controller = new AbortController(); controller.abort()
    await expect(enterpriseRequest(endpoint, '/snapshot', {}, { requestTimeoutMs: 1000, maxResponseBytes: 64 }, controller.signal)).rejects.toMatchObject({ code: 'cancelled' })
  })

  it('bounds an unresponsive endpoint and joins server teardown', async () => {
    const endpoint = await origin(() => {})
    await expect(enterpriseRequest(endpoint, '/snapshot', {}, { requestTimeoutMs: 20, maxResponseBytes: 64 }, new AbortController().signal)).rejects.toMatchObject({ code: 'timeout' })
  })
})
