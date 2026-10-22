import assert from "node:assert/strict"
import { test } from "node:test"

import {
  createAccountingSession,
  createExtensionHarness,
} from "../support/retitle-harness.js"

test("when a custom title policy is selected, persist its complete generated format", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  const harness = createExtensionHarness(async () => "OPS / BANKING / Import reconciliation", () => ({
    systemPrompt: "Custom title policy",
    custom: true,
    path: "project TITLE_SYSTEM.md",
  }))

  // Act
  await harness.handlers.get("agent_end")({}, harness.createContext(sessionManager))

  // Assert
  assert.equal(sessionManager.getSessionName(), "OPS / BANKING / Import reconciliation")
})

test("when a custom title policy is selected for a ticket, generate its complete format", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  sessionManager.appendMessage({ role: "user", content: "ACC-43: Fix transaction matching", timestamp: 1 })
  const harness = createExtensionHarness(async () => {
    return "FINANCE — Audit trail — Reconcile imported transactions"
  }, () => ({
    systemPrompt: "Custom title policy",
    custom: true,
    path: "project TITLE_SYSTEM.md",
  }))

  // Act
  await harness.handlers.get("agent_end")({}, harness.createContext(sessionManager))

  // Assert
  assert.equal(sessionManager.getSessionName(), "FINANCE — Audit trail — Reconcile imported transactions")
})

test("when a custom title policy cannot be read, preserve the title and allow a later request", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  await sessionManager.setSessionName("Existing title", "auto")
  let readable = false
  const harness = createExtensionHarness(async () => "Later complete title", () => {
    if (!readable) throw new Error("TITLE_SYSTEM.md is unreadable")
    return {
      systemPrompt: "Custom title policy",
      custom: true,
      path: "project TITLE_SYSTEM.md",
    }
  })
  const ctx = harness.createContext(sessionManager)

  // Act
  await assert.rejects(harness.handlers.get("agent_end")({}, ctx), /TITLE_SYSTEM\.md is unreadable/)
  assert.equal(sessionManager.getSessionName(), "Existing title")

  readable = true
  await harness.commands.get("retitle").handler("", ctx)

  // Assert
  assert.equal(sessionManager.getSessionName(), "Later complete title")
})

test("when a custom format supplies identifiers, compose them around the generated description", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  sessionManager.appendMessage({ role: "user", content: "ACC-43: Fix transaction matching", timestamp: 1 })
  const harness = createExtensionHarness(async () => "Reconcile imported transactions", () => ({
    systemPrompt: "Describe the task",
    format: "{reference} | {repository} | {description}",
    custom: true,
    path: "project TITLE_SYSTEM.md",
  }))

  // Act
  await harness.handlers.get("agent_end")({}, harness.createContext(sessionManager))

  // Assert
  assert.equal(sessionManager.getSessionName(), "ACC-43 | accounting | Reconcile imported transactions")
})
