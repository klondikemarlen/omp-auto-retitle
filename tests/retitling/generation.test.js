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

test("when a newer request produces no title, discard an older request's result", async () => {
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
  assert.equal(sessionManager.getSessionName(), "Existing title")
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

  // Act / Assert
  assert.equal(await retitleWithDefaultPolicy({}, { sessionManager }, {
    generateTitle: () => assert.fail("Manual titles must not request generation"),
  }), false)
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

test("when generated output is blank, preserve the existing title", async () => {
  // Arrange
  const sessionManager = createAccountingSession()
  await sessionManager.setSessionName("Existing title", "auto")

  // Act
  await retitleWithDefaultPolicy({}, { sessionManager }, {
    generateTitle: async () => " \n\t ",
  })

  // Assert
  assert.equal(sessionManager.getSessionName(), "Existing title")
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

test("when generation fails, propagate the error and allow a later retitle", async () => {
  // Arrange
  const sessionManager = createAccountingSession()

  // Act / Assert
  await assert.rejects(retitleWithDefaultPolicy({}, { sessionManager }, {
    generateTitle: async () => {
      throw new Error("Generation failed")
    },
  }), /Generation failed/)

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

  // Act
  await retitleWithDefaultPolicy({}, { sessionManager }, {
    generateTitle: () => assert.fail("A readable ticket subject must survive metadata updates"),
  })

  // Assert
  assert.equal(sessionManager.getSessionName(), "#251: [Bug] Preserve {province} selection — accounting")
})
