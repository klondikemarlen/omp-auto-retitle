import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import registerAutoRetitleExtension from "../../src/extension.js"
import { createTitleAnalytics, describeTitleAnalytics } from "../../src/omp/title-analytics.js"
import { createAccountingSession, getDefaultTitlePolicy, retitleWithDefaultPolicy } from "../support/retitle-harness.js"

function createAnalyticsFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "retitle-analytics-integration-"))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const requests = []
  return {
    directory,
    requests,
    createAnalytics(metadata) {
      const tracker = createTitleAnalytics(metadata, { directory })
      const request = { metadata, finishes: [] }
      requests.push(request)
      return {
        onUsage: (message) => tracker.onUsage(message),
        finish(outcome) {
          request.finishes.push(outcome)
          tracker.finish(outcome)
        },
      }
    },
  }
}

function billedMessage() {
  return {
    role: "assistant",
    provider: "analytics-test-provider",
    model: "analytics-test-model",
    content: [{ type: "text", text: "PRIVATE TITLE AND PROMPT" }],
    usage: { input: 1234, output: 56, cacheRead: 0, cacheWrite: 0, totalTokens: 1290 },
    errorMessage: "PRIVATE PROVIDER ERROR",
    credentials: "PRIVATE CREDENTIALS",
  }
}

test("when generation reports billed attempts, aggregate actual usage without private callback content", async (t) => {
  // Arrange
  const analytics = createAnalyticsFixture(t)
  const sessionManager = createAccountingSession()

  // Act
  const outcome = await retitleWithDefaultPolicy({}, { sessionManager }, {
    createAnalytics: analytics.createAnalytics,
    generateTitle: async (_input, _ctx, _pi, _policy, _signal, onUsage) => {
      onUsage(billedMessage())
      onUsage(billedMessage())
      return "Accounting import"
    },
  })

  // Assert
  assert.equal(outcome.status, "updated")
  assert.equal(analytics.requests.length, 1)
  assert.equal(analytics.requests[0].finishes.length, 1)
  assert.equal(analytics.requests[0].finishes[0].modelRequested, true)
  assert.ok(analytics.requests[0].finishes[0].elapsedMs >= 0)
  const report = describeTitleAnalytics({ directory: analytics.directory })
  assert.match(report, /analytics-test-provider/)
  assert.match(report, /analytics-test-model/)
  assert.match(report, /Total: 1 generations; 1 sessions; 2 usage attempts/)
  assert.match(report, /input=2468/)
  assert.match(report, /output=112/)
  assert.match(report, /totalTokens=2580/)
  assert.match(report, /Usage coverage: 1\/1 completed model-requested generations; 0 missing callbacks/)
  const stored = readdirSync(analytics.directory).map((file) => readFileSync(join(analytics.directory, file), "utf8")).join("\n")
  assert.doesNotMatch(stored, /PRIVATE|Accounting import|accounting/)
  assert.equal(stored.includes(sessionManager.getSessionId()), false)
})

test("when a ticket supplies a readable subject, record generation without a model attempt", async (t) => {
  // Arrange
  const analytics = createAnalyticsFixture(t)
  const sessionManager = createAccountingSession()
  sessionManager.appendMessage({ role: "user", content: "WRAPX-123: Reconcile bank imports", timestamp: 1 })

  // Act
  const outcome = await retitleWithDefaultPolicy({}, { sessionManager }, {
    createAnalytics: analytics.createAnalytics,
    generateTitle: () => assert.fail("A readable ticket subject does not need inference"),
  })

  // Assert
  assert.equal(outcome.status, "updated")
  assert.equal(analytics.requests.length, 1)
  assert.equal(analytics.requests[0].finishes.length, 1)
  assert.equal(analytics.requests[0].finishes[0].modelRequested, false)
  const report = describeTitleAnalytics({ directory: analytics.directory })
  assert.match(report, /Total: 1 generations; 1 sessions; 0 usage attempts/)
  assert.match(report, /No actual provider\/model telemetry recorded/)
})

test("when inference fails, report fallback and missing usage without persisting raw errors", async (t) => {
  // Arrange
  const analytics = createAnalyticsFixture(t)
  const sessionManager = createAccountingSession()

  // Act
  const outcome = await retitleWithDefaultPolicy({}, { sessionManager }, {
    createAnalytics: analytics.createAnalytics,
    generateTitle: async () => { throw new Error("PRIVATE PROVIDER ERROR") },
  })

  // Assert
  assert.equal(outcome.status, "fallback")
  assert.equal(analytics.requests[0].finishes.length, 1)
  const report = describeTitleAnalytics({ directory: analytics.directory })
  assert.match(report, /fallback=1/)
  assert.match(report, /Usage coverage: 0\/1 completed model-requested generations; 1 missing callbacks/)
  const stored = readdirSync(analytics.directory).map((file) => readFileSync(join(analytics.directory, file), "utf8")).join("\n")
  assert.doesNotMatch(stored, /PRIVATE/)
})

test("when policy loading fails, record error without requesting a model or persisting the policy path", async (t) => {
  // Arrange
  const analytics = createAnalyticsFixture(t)
  const sessionManager = createAccountingSession()

  // Act
  const generation = retitleWithDefaultPolicy({}, { sessionManager }, {
    createAnalytics: analytics.createAnalytics,
    generateTitle: () => assert.fail("Invalid policy must not invoke inference"),
    resolveTitlePolicy: () => { throw new Error("PRIVATE POLICY PATH") },
  })

  // Assert
  await assert.rejects(generation, /PRIVATE POLICY PATH/)
  assert.equal(analytics.requests[0].finishes.length, 1)
  const report = describeTitleAnalytics({ directory: analytics.directory })
  assert.match(report, /error=1/)
  assert.match(report, /Usage coverage: 0\/0 completed model-requested generations; 0 missing callbacks/)
  const stored = readdirSync(analytics.directory).map((file) => readFileSync(join(analytics.directory, file), "utf8")).join("\n")
  assert.doesNotMatch(stored, /PRIVATE/)
})

test("when a request is superseded, finalize once and retain its late billed callback", async (t) => {
  // Arrange
  const analytics = createAnalyticsFixture(t)
  const sessionManager = createAccountingSession()
  const started = Promise.withResolvers()
  const pending = Promise.withResolvers()
  let lateUsage
  const oldRequest = retitleWithDefaultPolicy({}, { sessionManager }, {
    createAnalytics: analytics.createAnalytics,
    generateTitle: (_input, _ctx, _pi, _policy, _signal, onUsage) => {
      lateUsage = onUsage
      started.resolve()
      return pending.promise
    },
  })
  await started.promise

  // Act
  await retitleWithDefaultPolicy({}, { sessionManager }, {
    createAnalytics: analytics.createAnalytics,
    generateTitle: async () => "Current accounting task",
  })
  const oldOutcome = await oldRequest
  lateUsage(billedMessage())

  // Assert
  assert.equal(oldOutcome.status, "stale")
  assert.equal(analytics.requests[0].finishes.length, 1)
  assert.equal(analytics.requests[1].finishes.length, 1)
  const report = describeTitleAnalytics({ directory: analytics.directory })
  assert.match(report, /analytics-test-model/)
  assert.match(report, /Total: 2 generations; 1 sessions; 1 usage attempts/)
  assert.match(report, /stale=1/)
  assert.match(report, /updated=1/)
  assert.match(report, /Usage coverage: 1\/2 completed model-requested generations; 1 missing callbacks/)
  assert.equal(sessionManager.getSessionName(), "Current accounting task — accounting")
})

test("when manual ownership or unchanged turns block retitling, create no extra analytics requests", async (t) => {
  // Arrange
  const analytics = createAnalyticsFixture(t)
  const handlers = new Map()
  const commands = new Map()
  registerAutoRetitleExtension({
    setLabel() {},
    on: (name, callback) => handlers.set(name, callback),
    registerCommand: (name, command) => commands.set(name, command),
  }, {
    createAnalytics: analytics.createAnalytics,
    generateTitle: async () => "Accounting import",
    resolveTitlePolicy: getDefaultTitlePolicy,
  })
  const sessionManager = createAccountingSession()
  const ctx = { sessionManager }
  await handlers.get("agent_end")({}, ctx)

  // Act
  sessionManager.appendMessage({ role: "user", content: "Keep going", timestamp: 1 })
  await handlers.get("agent_end")({}, ctx)
  await sessionManager.setSessionName("Manual title", "user")
  await commands.get("retitle").handler("", ctx)

  // Assert
  assert.equal(analytics.requests.length, 1)
  assert.equal(sessionManager.getSessionName(), "Manual title")
})

test("when analytics is requested, report locally without inference or title persistence", async (t) => {
  // Arrange
  const analytics = createAnalyticsFixture(t)
  let command
  const notifications = []
  registerAutoRetitleExtension({
    setLabel() {},
    on() {},
    registerCommand: (_name, value) => { command = value },
  }, {
    generateTitle: () => assert.fail("Analytics must not invoke inference"),
    createAnalytics: () => assert.fail("Analytics must not create a generation tracker"),
    describeAnalytics: () => describeTitleAnalytics({ directory: analytics.directory }),
  })
  const sessionManager = createAccountingSession()
  const entries = sessionManager.getEntries().slice()

  // Act
  await command.handler("analytics", { sessionManager, ui: { notify: (text) => notifications.push(text) } })

  // Assert
  assert.equal(notifications.length, 1)
  assert.match(notifications[0], /analytics/i)
  assert.deepEqual(sessionManager.getEntries(), entries)
  assert.deepEqual(command.getArgumentCompletions("").map(({ value }) => value), ["status", "analytics"])
  assert.deepEqual(command.getArgumentCompletions("ana").map(({ value }) => value), ["analytics"])
  assert.equal(command.getArgumentCompletions("unknown"), null)
})
