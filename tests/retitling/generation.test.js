import assert from "node:assert/strict"
import { test } from "node:test"

import {
  createAccountingSession,
  retitleWithDefaultPolicy,
} from "../support/retitle-harness.js"

test("when a title is generated, persist its normalized auto-owned value", async () => {
  // Arrange
  const sessionManager = createAccountingSession()

  // Act
  await retitleWithDefaultPolicy({}, { sessionManager }, {
    generateTitle: async () => "  Accounting import  ",
  })

  // Assert
  assert.equal(sessionManager.getSessionName(), "Accounting import — accounting")
  assert.equal(sessionManager.titleSource, "auto")
})

test("when generations complete out of order, keep the latest request's title", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  const generation = Promise.withResolvers()
  const older = retitleWithDefaultPolicy({}, { sessionManager }, {
    generateTitle: () => generation.promise,
  })

  // Act
  await retitleWithDefaultPolicy({}, { sessionManager }, {
    generateTitle: async () => "Latest accounting goal",
  })
  generation.resolve("Outdated accounting goal")
  await older

  // Assert
  assert.equal(sessionManager.getSessionName(), "Latest accounting goal — accounting")
})

test("when a newer request falls back locally, discard an older model result", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  await sessionManager.setSessionName("Existing title", "auto")
  const generation = Promise.withResolvers()
  const older = retitleWithDefaultPolicy({}, { sessionManager }, {
    generateTitle: () => generation.promise,
  })

  // Act
  await retitleWithDefaultPolicy({}, { sessionManager }, { generateTitle: async () => null })
  generation.resolve("Outdated accounting goal")
  await older

  // Assert
  assert.equal(sessionManager.getSessionName(), "Build accounting import — accounting")
})

test("when the selected session changes during generation, discard the pending title", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  const generation = Promise.withResolvers()
  const pending = retitleWithDefaultPolicy({}, { sessionManager }, {
    generateTitle: () => generation.promise,
  })

  // Act
  await sessionManager.newSession()
  generation.resolve("Previous session title")
  await pending

  // Assert
  assert.equal(sessionManager.getSessionName(), undefined)
})

test("when the selected branch changes during generation, discard the pending title", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  const originalLeaf = sessionManager.getLeafId()
  sessionManager.appendMessage({ role: "user", content: "Build a recipe blog instead", timestamp: 1 })
  const generation = Promise.withResolvers()
  const pending = retitleWithDefaultPolicy({}, { sessionManager }, {
    generateTitle: () => generation.promise,
  })

  // Act
  sessionManager.branch(originalLeaf)
  generation.resolve("Recipe blog")
  await pending

  // Assert
  assert.equal(sessionManager.getSessionName(), undefined)
})

test("when a message advances the selected branch during generation, discard the pending title", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  const generation = Promise.withResolvers()
  const pending = retitleWithDefaultPolicy({}, { sessionManager }, {
    generateTitle: () => generation.promise,
  })

  // Act
  sessionManager.appendMessage({ role: "user", content: "Switch to a recipe blog", timestamp: 1 })
  generation.resolve("Accounting import")
  await pending

  // Assert
  assert.equal(sessionManager.getSessionName(), undefined)
})

test("when a manual rename happens during generation, preserve user ownership", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  const generation = Promise.withResolvers()
  const pending = retitleWithDefaultPolicy({}, { sessionManager }, {
    generateTitle: () => generation.promise,
  })

  // Act
  await sessionManager.setSessionName("My chosen title", "user")
  generation.resolve("Generated title")
  await pending

  // Assert
  assert.equal(sessionManager.getSessionName(), "My chosen title")
  assert.equal(sessionManager.titleSource, "user")
})

test("when the title is manually owned, skip generation entirely", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  await sessionManager.setSessionName("My chosen title", "user")
  let generations = 0

  // Act
  const outcome = await retitleWithDefaultPolicy({}, { sessionManager }, {
    generateTitle: async () => {
      generations += 1
      return "Generated replacement"
    },
  })

  // Assert
  assert.equal(outcome.status, "protected")
  assert.equal(generations, 0)
})

test("when the generated title is unchanged, preserve title history", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  await sessionManager.setSessionName("Accounting import — accounting", "auto")
  const entries = sessionManager.getEntries()

  // Act
  await retitleWithDefaultPolicy({}, { sessionManager }, {
    generateTitle: async () => " Accounting import ",
  })

  // Assert
  assert.deepEqual(sessionManager.getEntries(), entries)
})

test("when generated output is blank, use the original request instead of a generic title", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  await sessionManager.setSessionName("Existing title", "auto")

  // Act
  const outcome = await retitleWithDefaultPolicy({}, { sessionManager }, {
    generateTitle: async () => " \n\t ",
  })

  // Assert
  assert.equal(sessionManager.getSessionName(), "Build accounting import — accounting")
  assert.equal(outcome.status, "fallback")
})

test("when separate sessions retitle concurrently, keep their requests independent", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  const otherSession = createAccountingSession()
  const generation = Promise.withResolvers()
  const pending = retitleWithDefaultPolicy({}, { sessionManager }, {
    generateTitle: () => generation.promise,
  })

  // Act
  await retitleWithDefaultPolicy({}, { sessionManager: otherSession }, {
    generateTitle: async () => "Other session goal",
  })
  generation.resolve("Accounting import")
  await pending

  // Assert
  assert.equal(sessionManager.getSessionName(), "Accounting import — accounting")
})

test("when generation fails, use grounded context and allow a later model refresh", async () => {
  // Arrange
  const sessionManager = createAccountingSession()

  // Act
  const outcome = await retitleWithDefaultPolicy({}, { sessionManager }, {
    generateTitle: async () => {
      throw new Error("Worker disconnected")
    },
  })

  // Assert
  assert.equal(outcome.status, "fallback")
  assert.equal(sessionManager.getSessionName(), "Build accounting import — accounting")

  await retitleWithDefaultPolicy({}, { sessionManager }, {
    generateTitle: async () => "Accounting import",
  })
  assert.equal(sessionManager.getSessionName(), "Accounting import — accounting")
})

test("when only title history changes during generation, keep the request fresh", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  const generation = Promise.withResolvers()
  const pending = retitleWithDefaultPolicy({}, { sessionManager }, {
    generateTitle: () => generation.promise,
  })

  // Act
  await sessionManager.setSessionName("Native interim title", "auto", "omp-native-auto-title")
  generation.resolve("Accounting import")
  await pending

  // Assert
  assert.equal(sessionManager.getSessionName(), "Accounting import — accounting")
  assert.equal(sessionManager.getEntries().filter((entry) => entry.type === "title_change").length, 2)
})

test("when an older title write finishes late, preserve the newer repair cache", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  const written = Promise.withResolvers()
  const persisted = Promise.withResolvers()
  const setName = sessionManager.setSessionName.bind(sessionManager)
  sessionManager.setSessionName = async (...args) => {
    const changed = await setName(...args)
    if (args[0] === "Original task — accounting") {
      written.resolve()
      await persisted.promise
    }
    return changed
  }
  const ctx = { sessionManager }
  const older = retitleWithDefaultPolicy({}, ctx, { generateTitle: async () => "Original task" })
  await written.promise
  await retitleWithDefaultPolicy({}, ctx, { generateTitle: async () => "Latest task" })

  // Act
  persisted.resolve()
  await older
  await sessionManager.setSessionName("Native generic title", "auto", "replan")

  // Assert
  assert.equal(sessionManager.getSessionName(), "Latest task — accounting")
})

test("when a tool supplies a Python dictionary as the ticket subject, generate a readable task title", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  sessionManager.appendMessage({
    role: "user",
    content: "Prepare the province-autofill review app for #251",
    timestamp: 1,
  })
  sessionManager.appendMessage({
    role: "toolResult",
    toolCallId: "issue-metadata",
    toolName: "bash",
    content: [{
      type: "text",
      text: "#251: {'state': 'OPEN', 'assignees': {'nodes': []}, 'projectItems': {'nodes': []}}",
    }],
    isError: false,
    timestamp: 2,
  })

  // Act
  await retitleWithDefaultPolicy({}, { sessionManager }, {
    generateTitle: async () => "Review province autofill",
  })

  // Assert
  assert.equal(sessionManager.getSessionName(), "#251: Review province autofill — accounting")
})

test("when a tool supplies JSON metadata as the ticket subject, generate a readable task title", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  sessionManager.appendMessage({
    role: "user",
    content: "Prepare the province-autofill review app for #251",
    timestamp: 1,
  })
  sessionManager.appendMessage({
    role: "toolResult",
    toolCallId: "issue-metadata",
    toolName: "bash",
    content: [{
      type: "text",
      text: '#251: {"state":"OPEN","assignees":{"nodes":[]},"projectItems":{"nodes":[]}}',
    }],
    isError: false,
    timestamp: 2,
  })

  // Act
  await retitleWithDefaultPolicy({}, { sessionManager }, {
    generateTitle: async () => "Review province autofill",
  })

  // Assert
  assert.equal(sessionManager.getSessionName(), "#251: Review province autofill — accounting")
})

test("when later metadata follows a readable ticket subject, preserve the subject without generation", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  sessionManager.appendMessage({
    role: "user",
    content: "#251: [Bug] Preserve {province} selection",
    timestamp: 1,
  })
  sessionManager.appendMessage({
    role: "toolResult",
    toolCallId: "issue-metadata",
    toolName: "bash",
    content: [{
      type: "text",
      text: '#251: {"state":"OPEN","assignees":{"nodes":[]}}',
    }],
    isError: false,
    timestamp: 2,
  })
  let generations = 0

  // Act
  await retitleWithDefaultPolicy({}, { sessionManager }, {
    generateTitle: async () => {
      generations += 1
      return "Generated replacement"
    },
  })

  // Assert
  assert.equal(sessionManager.getSessionName(), "#251: [Bug] Preserve {province} selection — accounting")
  assert.equal(generations, 0)
})

test("when inference never settles, commit an excerpt at the deadline and ignore late output", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  const generation = Promise.withResolvers()

  // Act
  const outcome = await retitleWithDefaultPolicy({}, { sessionManager }, {
    generateTitle: () => generation.promise,
    generationTimeoutMs: 1,
  })
  generation.resolve("Late model result")
  await generation.promise

  // Assert
  assert.equal(outcome.status, "fallback")
  assert.equal(sessionManager.getSessionName(), "Build accounting import — accounting")
})

test("when a newer request succeeds, release an older wait without waiting for its model", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  const generation = Promise.withResolvers()
  const older = retitleWithDefaultPolicy({}, { sessionManager }, { generateTitle: () => generation.promise })

  // Act
  await retitleWithDefaultPolicy({}, { sessionManager }, { generateTitle: async () => "Reconcile imports" })
  const outcome = await older

  // Assert
  assert.equal(outcome.status, "stale")
  assert.equal(sessionManager.getSessionName(), "Reconcile imports — accounting")
})

test("when a model fails after a successful title, retain the accepted same-task description", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  await retitleWithDefaultPolicy({}, { sessionManager }, { generateTitle: async () => "Reconcile bank statements" })
  const entries = sessionManager.getEntries().slice()

  // Act
  await retitleWithDefaultPolicy({}, { sessionManager }, { generateTitle: async () => null })

  // Assert
  assert.deepEqual(sessionManager.getEntries(), entries)
})

test("when a new ticket has no subject and inference fails, do not relabel the old task", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  await retitleWithDefaultPolicy({}, { sessionManager }, { generateTitle: async () => "Reconcile imports" })
  sessionManager.appendMessage({ role: "user", content: "Now work on ACC-99", timestamp: 1 })

  // Act
  const outcome = await retitleWithDefaultPolicy({}, { sessionManager }, { generateTitle: async () => null })

  // Assert
  assert.equal(outcome.status, "unavailable")
  assert.equal(sessionManager.getSessionName(), "Reconcile imports — accounting")
})
