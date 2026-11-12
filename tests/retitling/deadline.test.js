import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { test } from "node:test"

test("when inference finishes after ten seconds, accept its still-current title", () => {
  // Arrange
  const harnessUrl = new URL("../support/retitle-harness.js", import.meta.url).href

  // Act
  // Isolate the virtual clock so other suites keep their real timers.
  const child = spawnSync(process.execPath, ["--eval", `
    const { createAccountingSession, retitleWithDefaultPolicy } = await import(${JSON.stringify(harnessUrl)});
    const sessionManager = createAccountingSession();
    const timers = new Set();
    globalThis.setTimeout = (callback, delay) => {
      const timer = { callback, delay };
      timers.add(timer);
      return timer;
    };
    globalThis.clearTimeout = timer => timers.delete(timer);
    const generation = Promise.withResolvers();
    let signal;
    const pending = retitleWithDefaultPolicy({}, { sessionManager }, {
      generateTitle: (_input, _ctx, _pi, _policy, requestSignal) => {
        signal = requestSignal;
        return generation.promise;
      },
    });
    await Promise.resolve();
    for (const timer of timers) {
      if (timer.delay <= 15_000) timer.callback();
    }
    generation.resolve("Reconcile invoice imports");
    const outcome = await pending;
    console.log(JSON.stringify({ status: outcome.status, title: sessionManager.getSessionName(), aborted: signal.aborted }));
  `], { encoding: "utf8", timeout: 5000 })

  // Assert
  assert.equal(child.status, 0, child.stderr || child.error?.message)
  const result = JSON.parse(child.stdout)
  assert.equal(result.status, "updated")
  assert.equal(result.title, "Reconcile invoice imports — accounting")
  assert.equal(result.aborted, false)
})
