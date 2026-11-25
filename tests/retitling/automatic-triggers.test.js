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

test("when compaction keeps the known task, skip generation and keep explicit refreshes", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  let generations = 0
  const harness = createExtensionHarness(async () => `Accounting task ${++generations}`)
  const ctx = harness.createContext(sessionManager)
  await harness.handlers.get("agent_end")({}, ctx)
  const compactionId = sessionManager.appendCompaction("Continue the accounting import", undefined, sessionManager.getLeafId(), 400)
  const compactionEntry = sessionManager.getEntry(compactionId)
  const entriesBeforeCompaction = sessionManager.getEntries().slice()
  harness.handlers.get("tool_result")({
    toolName: "todo",
    isError: false,
    details: {
      op: "init",
    },
  }, ctx)

  // Act
  await harness.handlers.get("session_compact")({
    compactionEntry,
  }, ctx)
  const entriesAfterCompaction = sessionManager.getEntries().slice()
  const generationsAfterCompaction = generations
  await harness.handlers.get("agent_end")({}, ctx)
  await harness.commands.get("retitle").handler("", ctx)

  // Assert
  assert.equal(generationsAfterCompaction, 1)
  assert.deepEqual(entriesAfterCompaction, entriesBeforeCompaction)
  assert.equal(generations, 3)
  const titleChanges = sessionManager.getEntries().filter((entry) => entry.type === "title_change")
  assert.deepEqual(titleChanges.map((entry) => entry.trigger), [
    "omp-retitle:first-task",
    "omp-retitle:replan",
    "omp-retitle:command",
  ])
})

test("when compaction reveals a changed task before agent end, title it once", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  let generations = 0
  const harness = createExtensionHarness(async () => `Accounting task ${++generations}`)
  const ctx = harness.createContext(sessionManager)
  await harness.handlers.get("agent_end")({}, ctx)
  sessionManager.appendMessage({
    role: "user",
    content: "Now work on #42",
    timestamp: 1,
  })
  const compactionId = sessionManager.appendCompaction("Investigate issue #42", undefined, sessionManager.getLeafId(), 400)
  const compactionEntry = sessionManager.getEntry(compactionId)

  // Act
  await harness.handlers.get("session_compact")({
    compactionEntry,
  }, ctx)
  await harness.handlers.get("agent_end")({}, ctx)

  // Assert
  assert.equal(generations, 2)
  assert.equal(sessionManager.getSessionName(), "#42: Accounting task 2 — accounting")
  const titleChanges = sessionManager.getEntries().filter((entry) => entry.type === "title_change")
  assert.equal(titleChanges.at(-1).trigger, "omp-retitle:session_compact")
})

test("when compaction is the first trigger, a repeated event leaves its pending title eligible to commit", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  await sessionManager.setSessionName("Saved auto title", "auto", "omp-native-auto-title")
  const compactionId = sessionManager.appendCompaction("Continue the accounting import", undefined, sessionManager.getLeafId(), 400)
  const compactionEntry = sessionManager.getEntry(compactionId)
  const generation = Promise.withResolvers()
  let generations = 0
  const harness = createExtensionHarness(() => {
    generations += 1
    return generation.promise
  })
  const ctx = harness.createContext(sessionManager)
  const compact = harness.handlers.get("session_compact")
  const event = {
    compactionEntry,
  }

  // Act
  const pending = compact(event, ctx)
  const repeated = compact(event, ctx)
  generation.resolve("Accounting import")
  await Promise.all([pending, repeated])
  await harness.handlers.get("agent_end")({}, ctx)

  // Assert
  assert.equal(generations, 1)
  assert.equal(sessionManager.getSessionName(), "Accounting import — accounting")
  const titleChanges = sessionManager.getEntries().filter((entry) => entry.type === "title_change")
  assert.equal(titleChanges.at(-1).trigger, "omp-retitle:session_compact")
})

test("when a changed-task compact request fails, do not restore the old task and retry at agent end", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  const descriptions = ["Accounting import", null, "Reconcile bank statements"]
  let generations = 0
  const harness = createExtensionHarness(async () => descriptions[generations++])
  const ctx = harness.createContext(sessionManager)
  await harness.handlers.get("agent_end")({}, ctx)
  sessionManager.appendMessage({
    role: "user",
    content: "Now work on #42",
    timestamp: 1,
  })
  const compactionId = sessionManager.appendCompaction("Investigate issue #42", undefined, sessionManager.getLeafId(), 400)
  const compactionEntry = sessionManager.getEntry(compactionId)

  // Act
  await harness.handlers.get("session_compact")({
    compactionEntry,
  }, ctx)
  await sessionManager.setSessionName("Native ticket title", "auto", "omp-native-auto-title")
  const titleBeforeRetry = sessionManager.getSessionName()
  await harness.handlers.get("session_compact")({
    compactionEntry,
  }, ctx)
  await harness.handlers.get("agent_end")({}, ctx)
  await harness.handlers.get("agent_end")({}, ctx)

  // Assert
  assert.equal(titleBeforeRetry, "Native ticket title")
  assert.equal(generations, 3)
  assert.equal(sessionManager.getSessionName(), "#42: Reconcile bank statements — accounting")
  const titleChanges = sessionManager.getEntries().filter((entry) => entry.type === "title_change")
  assert.deepEqual(titleChanges.map((entry) => entry.trigger), [
    "omp-retitle:first-task",
    "omp-native-auto-title",
    "omp-retitle:first-task",
  ])
})

test("when a ticket supplies a subject, retain it across replans without a model call", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  sessionManager.appendMessage({ role: "user", content: "ACC-43: Fix transaction matching. Acknowledge with ready.", timestamp: 1 })
  let generations = 0
  const harness = createExtensionHarness(async () => {
    generations += 1
    return "Generated replacement"
  })
  const ctx = harness.createContext(sessionManager)
  await harness.handlers.get("agent_end")({}, ctx)

  // Act
  sessionManager.appendMessage({ role: "user", content: "For ACC-43, initialize the investigation plan", timestamp: 2 })
  harness.handlers.get("tool_result")({ toolName: "todo", isError: false, details: { op: "init" } }, ctx)
  await harness.handlers.get("agent_end")({}, ctx)

  // Assert
  assert.equal(sessionManager.getSessionName(), "ACC-43: Fix transaction matching — accounting")
  assert.equal(generations, 0)
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

test("when a ticket generation fails, retry at the next completed turn and then stop", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  sessionManager.appendMessage({ role: "user", content: "Work on ACC-42", timestamp: 1 })
  let attempts = 0
  const harness = createExtensionHarness(async () => ++attempts === 1 ? null : "Reconcile bank statements")
  const ctx = harness.createContext(sessionManager)

  // Act
  await harness.handlers.get("agent_end")({}, ctx)
  await harness.handlers.get("agent_end")({}, ctx)
  await harness.handlers.get("agent_end")({}, ctx)

  // Assert
  assert.equal(sessionManager.getSessionName(), "ACC-42: Reconcile bank statements — accounting")
  assert.equal(attempts, 2)
})

test("when shutdown interrupts generation, release the wait and preserve title history", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  const generation = Promise.withResolvers()
  const harness = createExtensionHarness(() => generation.promise)
  const ctx = harness.createContext(sessionManager)
  const pending = harness.handlers.get("agent_end")({}, ctx)
  const entries = sessionManager.getEntries().slice()

  // Act
  harness.handlers.get("session_shutdown")({}, ctx)
  await pending
  generation.resolve("Obsolete task")
  await generation.promise

  // Assert
  assert.deepEqual(sessionManager.getEntries(), entries)
})
