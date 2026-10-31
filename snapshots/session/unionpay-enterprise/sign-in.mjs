/** Normal member sign-in completes before the shipped headless runner accepts its task. */
export const name = 'unionpay-snapshot-sign-in'
export const inject = ['unionpayFixture', 'unionpayConnection', 'unionpayModels', 'unionpayUsage']

/** @param ctx - member connection and external fixture. */
export async function apply(ctx) {
  const state = await ctx.unionpayConnection.signInCode(ctx.unionpayFixture.code)
  if (state.status !== 'connected') throw new Error('Enterprise snapshot sign-in failed')
  ctx.provide('unionpayFixtureReady', true)
}
