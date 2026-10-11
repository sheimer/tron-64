// Playwright polls a synchronous predicate's return value. Await the imports
// separately: an async predicate returns a truthy Promise before its condition
// is ready, so it cannot enforce launch, ownership, or lifecycle transitions.
export async function exposeBrowserFixture(page) {
  await page.evaluate(async () => {
    const [{ state }, { network }, constants] = await Promise.all([
      import('/javascripts/state.js'),
      import('/javascripts/network.js'),
      import('/shared/constants.js'),
    ])
    window.browserFixture = { state, network, constants }
  })
}
