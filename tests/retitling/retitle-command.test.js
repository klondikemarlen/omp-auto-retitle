import assert from "node:assert/strict"
import { test } from "node:test"

import {
  createAccountingSession,
  createExtensionHarness,
} from "../support/retitle-harness.js"

test("when status inspects a deferred overwrite, show an overview and keep repair evidence in details", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  let generations = 0
  const harness = createExtensionHarness(async () => `Accounting task ${++generations}`)
  const ctx = harness.createContext(sessionManager)
  await harness.handlers.get("agent_end")({}, ctx)
  sessionManager.appendMessage({
    role: "user",
    content: "Continue checking the task",
    timestamp: 1,
  })
  await sessionManager.setSessionName("Native generic title", "auto", "native:replan")
  const entries = sessionManager.getEntries().slice()
  const command = harness.commands.get("retitle")

  // Act
  await command.handler("status", ctx)
  await command.handler("status details", ctx)

  // Assert
  const [[overview], [details]] = harness.notifications
  assert.deepEqual(sessionManager.getEntries(), entries)
  assert.equal(sessionManager.getSessionName(), "Native generic title")
  assert.equal(generations, 1)
  assert.match(overview, /Native generic title/)
  assert.match(overview, /\bauto(?:matic)?\b/i)
  assert.match(overview, /\/retitle status details\b/)
  assert.doesNotMatch(overview, /\b(?:pid|process)\s*[:#]?\s*\d/i)
  assert.doesNotMatch(overview, /file:\/\/|\/workspace\/accounting|default test prompt/i)
  assert.doesNotMatch(overview, /recent title writes|omp-retitle:first-task/i)
  assert.match(details, /conversation advanced/i)
  assert.match(details, /native:replan/)
})

test("when status inspects a manual title, report protected ownership without generation", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  await sessionManager.setSessionName("My chosen title", "user")
  const harness = createExtensionHarness(() => assert.fail("Status must not generate a title"))
  const ctx = harness.createContext(sessionManager)
  harness.handlers.get("session_start")({}, ctx)
  const entries = sessionManager.getEntries().slice()
  const command = harness.commands.get("retitle")

  // Act
  await command.handler("status", ctx)
  await command.handler("status details", ctx)

  // Assert
  const [[overview], [details]] = harness.notifications
  assert.equal(sessionManager.getSessionName(), "My chosen title")
  assert.equal(sessionManager.titleSource, "user")
  assert.deepEqual(sessionManager.getEntries(), entries)
  assert.match(overview, /My chosen title/)
  assert.match(overview, /\bmanual\b/i)
  assert.match(details, /manual title ownership/i)
})

test("when a retitle argument is unknown, report usage without renaming", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  const harness = createExtensionHarness(() => assert.fail("Unknown actions must not generate"))
  const ctx = harness.createContext(sessionManager)
  const entries = sessionManager.getEntries().slice()
  const command = harness.commands.get("retitle")

  // Act
  await command.handler("stats", ctx)
  await command.handler("status extra", ctx)

  // Assert
  const [[unknownAction], [unknownStatusArgument]] = harness.notifications
  assert.deepEqual(sessionManager.getEntries(), entries)
  assert.match(unknownAction, /usage: \/retitle\b/i)
  assert.match(unknownStatusArgument, /\busage: \/retitle\b.*\bdetails\b/i)
})

test("when completing retitle arguments, offer status details after the status argument", () => {
  // Arrange
  const harness = createExtensionHarness()
  const complete = harness.commands.get("retitle").getArgumentCompletions

  // Act
  const topLevel = complete("")
  const afterStatus = complete("status ")
  const partialDetail = complete("status det")
  const unsupported = complete("status extra")

  // Assert
  assert.deepEqual(topLevel.map(({ value }) => value), ["status", "analytics"])
  assert.deepEqual(afterStatus.map(({ value }) => value), ["status details"])
  assert.deepEqual(partialDetail.map(({ value }) => value), ["status details"])
  assert.equal(unsupported, null)
})
