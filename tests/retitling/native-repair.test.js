import assert from "node:assert/strict"
import { test } from "node:test"

import {
  createAccountingSession,
  createExtensionHarness,
} from "../support/retitle-harness.js"

test("when OMP writes a native auto title, restore the accepted title without generation", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  let generations = 0
  const harness = createExtensionHarness(async () => `Accounting task ${++generations}`)
  const ctx = harness.createContext(sessionManager)
  harness.handlers.get("session_start")({}, ctx)
  await harness.handlers.get("agent_end")({}, ctx)

  // Act
  await sessionManager.setSessionName("Native title", "auto", "omp-native-auto-title")

  // Assert
  assert.equal(sessionManager.getSessionName(), "accounting: Accounting task 1")
  assert.equal(generations, 1)
})

test("when a manual title replaces an accepted auto title, preserve user ownership", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  let generations = 0
  const harness = createExtensionHarness(async () => `Generated task ${++generations}`)
  const ctx = harness.createContext(sessionManager)
  await harness.handlers.get("agent_end")({}, ctx)

  // Act
  await sessionManager.setSessionName("User title", "user")
  await harness.handlers.get("agent_end")({}, ctx)

  // Assert
  assert.equal(sessionManager.getSessionName(), "User title")
  assert.equal(generations, 1)
})

test("when the branch changes, do not restore a title cached for the prior branch", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  const originalLeaf = sessionManager.getLeafId()
  const harness = createExtensionHarness(async () => "Accounting task")
  const ctx = harness.createContext(sessionManager)
  await harness.handlers.get("agent_end")({}, ctx)

  // Act
  sessionManager.appendMessage({ role: "user", content: "Change to a recipe blog", timestamp: 1 })
  await harness.handlers.get("session_branch")({}, ctx)
  sessionManager.branch(originalLeaf)
  await sessionManager.setSessionName("Native title", "auto", "omp-native-auto-title")

  // Assert
  assert.equal(sessionManager.getSessionName(), "Native title")
})

test("when the session changes, do not restore a title cached for another session", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  const harness = createExtensionHarness(async () => "Accounting task")
  const ctx = harness.createContext(sessionManager)
  await harness.handlers.get("agent_end")({}, ctx)

  // Act
  await sessionManager.newSession()
  await harness.handlers.get("session_switch")({}, ctx)
  await sessionManager.setSessionName("Native title", "auto", "omp-native-auto-title")

  // Assert
  assert.equal(sessionManager.getSessionName(), "Native title")
})

test("when the user changes the task, do not restore the previously accepted title", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  const harness = createExtensionHarness(async () => "Accounting task")
  const ctx = harness.createContext(sessionManager)
  await harness.handlers.get("agent_end")({}, ctx)

  // Act
  sessionManager.appendMessage({ role: "user", content: "Switch to a recipe blog", timestamp: 1 })
  await sessionManager.setSessionName("Native title", "auto", "omp-native-auto-title")

  // Assert
  assert.equal(sessionManager.getSessionName(), "Native title")
})

test("when a native title write occurs during newer generation, keep its interim value until commit", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  const generation = Promise.withResolvers()
  let calls = 0
  const harness = createExtensionHarness(() => {
    calls += 1
    return calls === 1 ? "Original task" : generation.promise
  })
  const ctx = harness.createContext(sessionManager)
  await harness.handlers.get("agent_end")({}, ctx)
  const retitling = harness.commands.get("retitle").handler("", ctx)

  // Act
  await sessionManager.setSessionName("Native interim title", "auto", "omp-native-auto-title")

  // Assert
  assert.equal(sessionManager.getSessionName(), "Native interim title")

  // Finish the controlled request after proving the old title was not restored.
  generation.resolve("Updated task")
  await retitling
  assert.equal(sessionManager.getSessionName(), "accounting: Updated task")
  assert.equal(calls, 2)
})

test("when conversation progress defers an auto overwrite, repair at the same-task turn boundary", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  let generations = 0
  const harness = createExtensionHarness(async () => `Accounting task ${++generations}`)
  const ctx = harness.createContext(sessionManager)
  await harness.handlers.get("agent_end")({}, ctx)
  sessionManager.appendMessage({ role: "user", content: "Continue checking UUID creation", timestamp: 1 })
  await sessionManager.setSessionName("PARK: Keep UUIDs at group creation", "auto", "replan")

  // Act
  await harness.handlers.get("agent_end")({}, ctx)

  // Assert
  assert.equal(sessionManager.getSessionName(), "accounting: Accounting task 1")
  assert.equal(generations, 1)
  assert.equal(sessionManager.getEntries().at(-1).trigger, "omp-auto-retitle:settled-repair")
})

test("when deferred repair is followed by a ticket change, commit the new task instead", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  const harness = createExtensionHarness(async () => "Accounting import")
  const ctx = harness.createContext(sessionManager)
  await harness.handlers.get("agent_end")({}, ctx)
  sessionManager.appendMessage({ role: "user", content: "ACC-43: Fix transaction matching", timestamp: 1 })
  await sessionManager.setSessionName("Native generic title", "auto", "replan")

  // Act
  await harness.handlers.get("agent_end")({}, ctx)

  // Assert
  assert.equal(sessionManager.getSessionName(), "accounting ACC-43: Fix transaction matching")
  assert.equal(sessionManager.getEntries().at(-1).trigger, "omp-auto-retitle:task")
})
