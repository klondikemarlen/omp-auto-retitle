import assert from "node:assert/strict"
import { test } from "node:test"

import {
  createAccountingSession,
  createExtensionHarness,
} from "../support/retitle-harness.js"

test("when the first agent run completes, title once and skip unchanged followups", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  let generations = 0
  const harness = createExtensionHarness(async () => `Accounting task ${++generations}`)
  const ctx = harness.createContext(sessionManager)

  // Act
  await harness.handlers.get("agent_end")({}, ctx)
  await harness.handlers.get("agent_end")({}, ctx)

  // Assert
  assert.equal(generations, 1)
  assert.equal(sessionManager.getSessionName(), "Accounting task 1 — accounting")
})

test("when the active ticket changes, retitle on the next completed agent run", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  let generations = 0
  const harness = createExtensionHarness(async () => `Ticket task ${++generations}`)
  const ctx = harness.createContext(sessionManager)
  await harness.handlers.get("agent_end")({}, ctx)

  // Act
  sessionManager.appendMessage({ role: "user", content: "Now work on #42", timestamp: 1 })
  await harness.handlers.get("agent_end")({}, ctx)

  // Assert
  assert.equal(generations, 2)
  assert.match(sessionManager.getSessionName(), /#42/)
})

test("when todo init succeeds, retitle once at the next agent end", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  let generations = 0
  const harness = createExtensionHarness(async () => `Plan task ${++generations}`)
  const ctx = harness.createContext(sessionManager)
  await harness.handlers.get("agent_end")({}, ctx)

  // Act
  harness.handlers.get("tool_result")({
    toolName: "todo",
    isError: false,
    details: { op: "init" },
  }, ctx)
  await harness.handlers.get("agent_end")({}, ctx)
  await harness.handlers.get("agent_end")({}, ctx)

  // Assert
  assert.equal(generations, 2)
  assert.equal(sessionManager.getSessionName(), "Plan task 2 — accounting")
})

test("when compaction or the command requests retitling, use the corresponding title trigger", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  let generations = 0
  const harness = createExtensionHarness(async () => `Explicit task ${++generations}`)
  const ctx = harness.createContext(sessionManager)

  // Act
  await harness.handlers.get("session_compact")({ summary: "Compacted task" }, ctx)
  await harness.commands.get("retitle").handler("", ctx)

  // Assert
  const titleChanges = sessionManager.getEntries().filter((entry) => entry.type === "title_change")
  assert.equal(titleChanges[0].trigger, "omp-auto-retitle:session_compact")
  assert.equal(titleChanges[1].trigger, "omp-auto-retitle:command")
  assert.equal(harness.notifications.at(-1)[0], "Session title regenerated")
  assert.equal(generations, 2)
})

test("when a ticket supplies a subject, retain it across replans without a model call", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  sessionManager.appendMessage({ role: "user", content: "ACC-43: Fix transaction matching. Acknowledge with ready.", timestamp: 1 })
  const harness = createExtensionHarness(() => assert.fail("An explicit ticket subject does not need generation"))
  const ctx = harness.createContext(sessionManager)
  await harness.handlers.get("agent_end")({}, ctx)

  // Act
  sessionManager.appendMessage({ role: "user", content: "For ACC-43, initialize the investigation plan", timestamp: 2 })
  harness.handlers.get("tool_result")({ toolName: "todo", isError: false, details: { op: "init" } }, ctx)
  await harness.handlers.get("agent_end")({}, ctx)

  // Assert
  assert.equal(sessionManager.getSessionName(), "ACC-43: Fix transaction matching — accounting")
})

test("when the active ticket changes, do not reuse another ticket's explicit subject", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  sessionManager.appendMessage({ role: "user", content: "ACC-42: Fix bank imports", timestamp: 1 })
  const harness = createExtensionHarness(async () => "Explain transaction isolation")
  const ctx = harness.createContext(sessionManager)
  await harness.handlers.get("agent_end")({}, ctx)

  // Act
  sessionManager.appendMessage({ role: "user", content: "Now work on ACC-43", timestamp: 2 })
  await harness.handlers.get("agent_end")({}, ctx)

  // Assert
  assert.equal(sessionManager.getSessionName(), "ACC-43: Explain transaction isolation — accounting")
})
