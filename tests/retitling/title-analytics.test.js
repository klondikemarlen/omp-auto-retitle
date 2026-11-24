import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import registerRetitleExtension from "../../src/extension.js"
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
      const tracker = createTitleAnalytics(metadata, {
        directory,
      })
      const request = {
        metadata,
        finishes: [],
      }
      requests.push(request)
      return {
        requestId: tracker.requestId,
        onUsage: (message) => tracker.onUsage(message),
        onNativeReason: (reason) => tracker.onNativeReason(reason),
        finish(outcome) {
          request.finishes.push(outcome)
          tracker.finish(outcome)
        },
      }
    },
  }
}

function readAnalyticsRecords(directory) {
  return readdirSync(directory).flatMap((file) => {
    const log = readFileSync(join(directory, file), "utf8")
    return log.trim().split("\n").map((line) => JSON.parse(line))
  })
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
  assert.match(report, /1 request across 1 session/)
  assert.match(report, /Model calls: 2 reported/)
  assert.match(report, /Tokens: 2,580 total · 2,468 input · 112 output/)
  assert.doesNotMatch(report, /Usage unavailable/)
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
  assert.match(report, /1 request across 1 session/)
  assert.match(report, /Model calls: 0 reported/)
  assert.match(report, /Model: not reported/)
})

test("when the host returns no title, correlate the warning and status with the stored request", async (t) => {
  // Arrange
  const analytics = createAnalyticsFixture(t)
  const sessionManager = createAccountingSession()
  const notifications = []
  let command
  registerRetitleExtension({
    setLabel() {},
    on() {},
    registerCommand: (_name, value) => { command = value },
  }, {
    createAnalytics: analytics.createAnalytics,
    describeAnalytics: () => describeTitleAnalytics({
      directory: analytics.directory,
    }),
    generateTitle: async (_input, _ctx, _pi, _policy, _signal, _onUsage, onNativeReason) => {
      onNativeReason("invalid-title")
      return null
    },
    resolveTitlePolicy: getDefaultTitlePolicy,
  })
  const extensionContext = {
    sessionManager,
    ui: {
      notify: (message, severity) => notifications.push({
        message,
        severity,
      }),
    },
  }

  // Act
  await command.handler("", extensionContext)
  await command.handler("status", extensionContext)
  await command.handler("analytics", extensionContext)

  // Assert
  const [warning, status, report] = notifications
  const records = readAnalyticsRecords(analytics.directory)
  const start = records.find((record) => record.type === "start")
  const finish = records.find((record) => record.type === "finish")
  assert.equal(finish.failureKind, "host-no-title")
  assert.equal(finish.nativeReason, "invalid-title")
  assert.equal(finish.status, "fallback")
  assert.equal(finish.requestId, start.requestId)
  assert.equal(sessionManager.getSessionName(), "Build accounting import — accounting")
  assert.equal(warning.severity, "warning")
  assert.match(warning.message, /\/retitle analytics/)
  assert.ok(warning.message.includes(finish.requestId))
  assert.match(status.message, /Last generation outcome: .*\/retitle analytics/)
  assert.ok(status.message.includes(warning.message))
  assert.ok(report.message.includes(finish.requestId))
  assert.match(report.message, /invalid-title/)
})

test("when inference fails, report fallback and missing usage without persisting raw errors", async (t) => {
  // Arrange
  const analytics = createAnalyticsFixture(t)
  const sessionManager = createAccountingSession()

  // Act
  const outcome = await retitleWithDefaultPolicy({}, { sessionManager }, {
    createAnalytics: analytics.createAnalytics,
    generateTitle: async () => { throw new Error("PRIVATE PROVIDER ERROR: Title generation timed out") },
  })

  // Assert
  assert.equal(outcome.status, "fallback")
  assert.equal(analytics.requests[0].finishes.length, 1)
  const finish = readAnalyticsRecords(analytics.directory).find((record) => record.type === "finish")
  assert.equal(finish.failureKind, "generator-error")
  const report = describeTitleAnalytics({ directory: analytics.directory })
  assert.match(report, /1 fallback/)
  assert.match(report, /Usage unavailable for 1 completed model request/)
  const stored = readdirSync(analytics.directory).map((file) => readFileSync(join(analytics.directory, file), "utf8")).join("\n")
  assert.doesNotMatch(stored, /PRIVATE/)
})

test("when the plugin deadline expires, store timeout without classifying late output", async (t) => {
  // Arrange
  const analytics = createAnalyticsFixture(t)
  const sessionManager = createAccountingSession()
  const pending = Promise.withResolvers()

  // Act
  const outcome = await retitleWithDefaultPolicy({}, { sessionManager }, {
    createAnalytics: analytics.createAnalytics,
    generateTitle: () => pending.promise,
    generationTimeoutMs: 1,
  })
  pending.resolve(null)
  await pending.promise

  // Assert
  assert.equal(outcome.status, "fallback")
  assert.match(outcome.message, /timed out/)
  const finishes = readAnalyticsRecords(analytics.directory).filter((record) => record.type === "finish")
  assert.deepEqual(finishes.map((record) => record.failureKind), ["timeout"])
})

test("when a returned description is only a file citation, store citation-only instead of host-no-title", async (t) => {
  // Arrange
  const analytics = createAnalyticsFixture(t)
  const sessionManager = createAccountingSession()

  // Act
  const outcome = await retitleWithDefaultPolicy({}, { sessionManager }, {
    createAnalytics: analytics.createAnalytics,
    generateTitle: async () => "[steps.ts:26](https://github.com/example/accounting/blob/main/steps.ts#L26)",
  })

  // Assert
  assert.equal(outcome.status, "fallback")
  assert.match(outcome.message, /only a file citation/)
  const finish = readAnalyticsRecords(analytics.directory).find((record) => record.type === "finish")
  assert.equal(finish.failureKind, "citation-only")
})

test("when a format discards a usable description, do not record a host failure", async (t) => {
  // Arrange
  const analytics = createAnalyticsFixture(t)
  const sessionManager = createAccountingSession()
  const defaultTitlePolicy = getDefaultTitlePolicy()
  const titlePolicy = {
    ...defaultTitlePolicy,
    custom: true,
    format: "{reference}",
  }

  // Act
  const outcome = await retitleWithDefaultPolicy({}, { sessionManager }, {
    createAnalytics: analytics.createAnalytics,
    generateTitle: async () => "Accounting import",
    resolveTitlePolicy: () => titlePolicy,
  })

  // Assert
  assert.equal(outcome.status, "unavailable")
  const finish = readAnalyticsRecords(analytics.directory).find((record) => record.type === "finish")
  assert.equal(finish.failureKind, undefined)
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
  const finish = readAnalyticsRecords(analytics.directory).find((record) => record.type === "finish")
  assert.equal(finish.failureKind, undefined)
  const report = describeTitleAnalytics({ directory: analytics.directory })
  assert.match(report, /1 failed/)
  assert.doesNotMatch(report, /Usage unavailable/)
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
  pending.resolve(null)
  await pending.promise

  // Assert
  assert.equal(oldOutcome.status, "stale")
  assert.equal(analytics.requests[0].finishes.length, 1)
  assert.equal(analytics.requests[1].finishes.length, 1)
  const staleFinish = readAnalyticsRecords(analytics.directory).find((record) => record.type === "finish" && record.status === "stale")
  assert.equal(staleFinish.failureKind, undefined)
  const report = describeTitleAnalytics({ directory: analytics.directory })
  assert.match(report, /analytics-test-model/)
  assert.match(report, /2 requests across 1 session/)
  assert.match(report, /1 superseded/)
  assert.match(report, /1 updated/)
  assert.match(report, /Usage unavailable for 1 completed model request/)
  assert.equal(sessionManager.getSessionName(), "Current accounting task — accounting")
})

test("when manual ownership or unchanged turns block retitling, create no extra analytics requests", async (t) => {
  // Arrange
  const analytics = createAnalyticsFixture(t)
  const handlers = new Map()
  const commands = new Map()
  registerRetitleExtension({
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
  registerRetitleExtension({
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
