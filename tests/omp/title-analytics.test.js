import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { createTitleAnalytics, describeTitleAnalytics } from "../../src/omp/title-analytics.js"

function temporaryStore(t) {
  const directory = mkdtempSync(join(tmpdir(), "title-analytics-"))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return directory
}

function track(directory, sessionId = "session-one", reason = "command") {
  return createTitleAnalytics({ sessionId, reason, version: "1.2.3" }, { directory })
}

function message(usage, model = "tiny", provider = "provider") {
  return { role: "assistant", provider, model, usage }
}

function records(directory) {
  return readdirSync(directory).flatMap((file) => readFileSync(join(directory, file), "utf8").trim().split("\n").map(JSON.parse))
}

test("when independent processes record usage, aggregate generations and sessions without losing attempts", (t) => {
  // Arrange
  const directory = temporaryStore(t)
  const first = track(directory)
  first.onUsage(message({ input: 10, output: 2, totalTokens: 12 }))
  first.finish({ status: "updated", modelRequested: true, elapsedMs: 100 })
  const second = track(directory, "session-two", "replan")
  second.finish({ status: "unchanged", modelRequested: false, elapsedMs: 20 })
  const moduleUrl = new URL("../../src/omp/title-analytics.js", import.meta.url).href
  const child = spawnSync(process.execPath, ["--eval", `
    const { createTitleAnalytics } = await import(${JSON.stringify(moduleUrl)});
    const tracker = createTitleAnalytics({ sessionId: "session-one", reason: "command", version: "1.2.3" }, { directory: ${JSON.stringify(directory)} });
    tracker.onUsage({ role: "assistant", provider: "provider", model: "tiny", usage: { input: 5, output: 3, totalTokens: 8 } });
    tracker.finish({ status: "updated", modelRequested: true, elapsedMs: 30 });
  `], { encoding: "utf8" })
  assert.equal(child.status, 0, child.stderr || child.error?.message)

  // Act
  const report = describeTitleAnalytics({ directory })

  // Assert
  assert.equal(readdirSync(directory).length, 2)
  assert.match(report, /3 requests across 2 sessions/)
  assert.match(report, /2 updated/)
  assert.match(report, /1 unchanged/)
  assert.match(report, /0\.05 s average · 0\.10 s slowest/)
  assert.match(report, /Model: provider \/ tiny/)
  assert.match(report, /Model calls: 2 reported/)
  assert.match(report, /Tokens: 20 total · 15 input · 5 output/)
})

test("when retries report late usage, attribute each attempt to its finished generation", (t) => {
  // Arrange
  const directory = temporaryStore(t)
  const tracker = track(directory)
  tracker.onUsage(message({ input: 10 }, "first-model"))
  tracker.finish({ status: "stale", modelRequested: true, elapsedMs: 50 })

  // Act
  tracker.onUsage(message({ input: 20, output: 4 }, "retry-model", "other-provider"))
  tracker.finish({ status: "updated", modelRequested: true, elapsedMs: 900 })
  const report = describeTitleAnalytics({ directory })

  // Assert
  assert.match(report, /1 request across 1 session/)
  assert.match(report, /1 superseded/)
  assert.doesNotMatch(report, /Usage unavailable/)
  assert.match(report, /other-provider \/ retry-model: 1 call/)
  assert.match(report, /provider \/ first-model: 1 call/)
  assert.match(report, /30 input · 4 reported \(1\/2 calls\) output/)
  assert.equal(records(directory).filter((record) => record.type === "finish").length, 1)
})

test("when telemetry is partial, distinguish reported zero from absent categories and callbacks", (t) => {
  // Arrange
  const directory = temporaryStore(t)
  const zero = track(directory)
  zero.onUsage(message({ input: 0, output: 0, totalTokens: 0, cacheRead: -1, cacheWrite: "0", reasoningTokens: Infinity, cost: { total: 0 } }))
  zero.finish({ status: "updated", modelRequested: true, elapsedMs: 0 })
  const missing = track(directory, "another-session")
  missing.finish({ status: "unavailable", modelRequested: true, elapsedMs: 10 })
  track(directory, "interrupted-session")

  // Act
  const report = describeTitleAnalytics({ directory })

  // Assert
  assert.match(report, /Tokens: 0 total · 0 input · 0 output/)
  assert.match(report, /Usage unavailable for 1 completed model request/)
  assert.match(report, /1 request unfinished/)
  assert.match(report, /1 unavailable/)
  assert.match(report, /1 updated/)
})

test("when callbacks contain private fields, persist only whitelisted metadata and numeric usage", (t) => {
  // Arrange
  const directory = temporaryStore(t)
  const tracker = createTitleAnalytics({ sessionId: "/secret/session/path", reason: "secret reason", version: "secret version", prompt: "secret prompt" }, { directory })

  // Act
  tracker.onUsage({
    ...message({ input: 1, output: 2, totalTokens: 3, premiumRequests: 4, private: "secret usage", cost: { total: 0.02, private: "secret cost" } }),
    content: [{ text: "secret title" }], credentialId: "secret credential", responseId: "secret response",
    providerPayload: { token: "secret token" }, errorMessage: "secret provider error",
  })
  tracker.onUsage({ role: "user", usage: { input: 999 } })
  tracker.finish({ status: "secret error", modelRequested: true, elapsedMs: 5, error: "secret failure" })
  const saved = records(directory)

  // Assert
  assert.equal(saved.length, 3)
  assert.doesNotMatch(JSON.stringify(saved), /secret|premiumRequests|credential|responseId|providerPayload|content/)
  assert.match(saved[0].sessionHash, /^[a-f0-9]{64}$/)
  assert.equal(saved[0].reason, "unknown")
  assert.deepEqual(saved[1].usage, { input: 1, output: 2, totalTokens: 3 })
  assert.deepEqual(saved[1].estimatedCost, { total: 0.02 })
  assert.equal(saved[2].status, "unknown")
})

test("when logs contain malformed records, report incomplete coverage and retain valid data", (t) => {
  // Arrange
  const directory = temporaryStore(t)
  const tracker = track(directory)
  tracker.onUsage(message({ input: 7 }))
  appendFileSync(join(directory, readdirSync(directory)[0]), '{"partial":\n{"schema":900,"private":"secret"}\n')
  const orphan = { schema: 1, requestId: "00000000-0000-4000-8000-000000000000", timestamp: new Date().toISOString(), type: "usage", usage: { input: 999 } }
  writeFileSync(join(directory, "orphan.jsonl"), `${JSON.stringify(orphan)}\n`)

  // Act
  const report = describeTitleAnalytics({ directory })

  // Assert
  assert.match(report, /1 request across 1 session/)
  assert.match(report, /1 unfinished/)
  assert.match(report, /2 invalid records skipped; 1 request without a start record/)
  assert.doesNotMatch(report, /secret|999/)
})

test("when usage arrives after midnight, use the request start day for attribution", (t) => {
  // Arrange
  const directory = temporaryStore(t)
  const tracker = track(directory)
  tracker.finish({ status: "stale", modelRequested: true, elapsedMs: 10 })
  tracker.onUsage(message({ input: 8 }))
  const file = join(directory, readdirSync(directory)[0])
  const saved = records(directory)
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.parse(today) - 86_400_000).toISOString().slice(0, 10)
  saved[0].timestamp = `${yesterday}T23:59:59.999Z`
  writeFileSync(file, saved.map((record) => JSON.stringify(record)).join("\n") + "\n")

  // Act
  const todayReport = describeTitleAnalytics({ days: 1, directory })
  const twoDayReport = describeTitleAnalytics({ days: 2, directory })

  // Assert
  assert.match(todayReport, /No title activity recorded/)
  assert.match(twoDayReport, /1 request across 1 session/)
  assert.match(twoDayReport, /8 input/)
})

test("when storage fails, warn without exposing errors or breaking generation consumers", (t) => {
  // Arrange
  const root = temporaryStore(t)
  const directory = join(root, "secret-not-a-directory")
  writeFileSync(directory, "occupied")
  const warnings = []
  const originalWarn = console.warn
  console.warn = (warning) => warnings.push(warning)
  t.after(() => { console.warn = originalWarn })

  // Act
  assert.doesNotThrow(() => {
    const tracker = track(directory)
    tracker.onUsage(message({ input: 4 }))
    tracker.finish({ status: "updated", modelRequested: true, elapsedMs: 1 })
  })
  const report = describeTitleAnalytics({ directory })

  // Assert
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /could not be saved/)
  assert.doesNotMatch(warnings[0], /secret|ENOTDIR|occupied/)
  assert.match(report, /1 unreadable file or directory/)
  assert.doesNotMatch(report, /secret|ENOTDIR|occupied/)
})

test("when a store is unused, report missing telemetry without inferring zero model usage", (t) => {
  // Arrange
  const directory = join(temporaryStore(t), "not-created")

  // Act
  const report = describeTitleAnalytics({ directory })

  // Assert
  assert.match(report, /No title activity recorded/)
  assert.doesNotMatch(report, /Tokens: 0|Model calls: 0|Storage warning/)
})
