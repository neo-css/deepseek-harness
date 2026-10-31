/** Scoped Host composition for focused enterprise tests; profile smoke tests cover Loader assembly separately. */
import { Context } from '@deepseek-ai/cordis'
import { join } from 'node:path'
import Credentials from '@deepseek-ai/dsh-credentials-local'
import Authorization from '@deepseek-ai/dsh-authorization'
import Llm from '@deepseek-ai/dsh-llm'
import Storage from '@deepseek-ai/dsh-storage'
import * as JsonStorage from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import Connection from '@deepseek-ai/dsh-unionpay-connection'
import Models from '@deepseek-ai/dsh-llm-unionpay'
import Usage, { type Config as UsageConfig } from '@deepseek-ai/dsh-unionpay-usage'

/** Caller owns ctx.fiber.dispose after successful construction; failed construction cleans up its acquired services. */
export async function enterpriseHost(origin: string, root: string, usageConfig: Partial<UsageConfig> = {}) {
  const ctx = new Context()
  try {
    await ctx.plugin(Credentials, { path: join(root, 'credentials.yml'), watch: false })
    await ctx.plugin(Authorization)
    await ctx.plugin(Llm)
    await ctx.plugin(Storage)
    await ctx.plugin(JsonStorage, { root: join(root, 'data') })
    await ctx.plugin(StorageDomain, { backend: 'json' })
    const connection = ctx.plugin(Connection, { origin, refreshIntervalMs: 3600000 })
    await connection
    const models = ctx.plugin(Models, { maxRetries: 0 })
    await models
    const usage = ctx.plugin(Usage, { flushIntervalMs: 3600000, collectionRefreshMs: 1, ...usageConfig })
    await usage
    return { ctx, connection, models, usage }
  } catch (error) { await ctx.fiber.dispose(); throw error }
}
