/** Invoke the shipped BTW command once after the parent model reply, before its turn settles. */
export const name = 'btw-snapshot-command'
export const inject = ['commands']

/** @param ctx - command and Agent lifecycle services. */
export function apply(ctx) {
  const controller = new AbortController()
  ctx.effect(() => () => controller.abort(new Error('BTW snapshot unloaded')))
  let asked = false
  ctx.on('agent/turn-stopping', async ({ agent }) => {
    if (asked || agent.session.header.parentSession !== undefined) return
    asked = true
    const execution = await ctx.commands.execute(agent, '/btw Recap the enterprise connection without using tools.', [], controller.signal)
    if (execution?.result.kind !== 'success') throw new Error('BTW snapshot command failed: ' + execution?.result.text)
  })
}
