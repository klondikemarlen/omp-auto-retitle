import assert from "node:assert/strict"
import { test } from "node:test"

import {
  createAccountingSession,
  createExtensionHarness,
} from "../support/retitle-harness.js"

test("when status inspects a deferred overwrite, report its cause without changing history", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  let generations = 0
  const harness = createExtensionHarness(async () => `Accounting task ${++generations}`)
  const ctx = harness.createContext(sessionManager)
  await harness.handlers.get("agent_end")({}, ctx)
  sessionManager.appendMessage({ role: "user", content: "Continue checking the task", timestamp: 1 })
  await sessionManager.setSessionName("Native generic title", "auto", "replan")
  const entries = sessionManager.getEntries().slice()

  // Act
  await harness.commands.get("retitle").handler("status", ctx)

  // Assert
  assert.deepEqual(sessionManager.getEntries(), entries)
  assert.equal(generations, 1)
  assert.match(harness.notifications.at(-1)[0], /Skipped: conversation advanced/)
  assert.match(harness.notifications.at(-1)[0], /auto \| replan \| Native generic title/)
})

test("when status inspects a manual title, report protected ownership without generation", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  await sessionManager.setSessionName("My chosen title", "user")
  const harness = createExtensionHarness(() => assert.fail("Status must not generate a title"))
  const ctx = harness.createContext(sessionManager)
  harness.handlers.get("session_start")({}, ctx)

  // Act
  await harness.commands.get("retitle").handler("status", ctx)

  // Assert
  assert.equal(sessionManager.getSessionName(), "My chosen title")
  assert.match(harness.notifications.at(-1)[0], /Ownership: user/)
  assert.match(harness.notifications.at(-1)[0], /Repair eligibility: manual title ownership/)
})

test("when a retitle argument is unknown, report usage without renaming", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  const harness = createExtensionHarness(() => assert.fail("Unknown actions must not generate"))
  const ctx = harness.createContext(sessionManager)
  const entries = sessionManager.getEntries().slice()

  // Act
  await harness.commands.get("retitle").handler("stats", ctx)

  // Assert
  assert.deepEqual(sessionManager.getEntries(), entries)
  assert.match(harness.notifications.at(-1)[0], /Usage: \/retitle \[status\]/)
})
