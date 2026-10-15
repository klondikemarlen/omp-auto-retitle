import assert from "node:assert/strict"
import { test } from "node:test"

import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager"

import { retitleFromCompaction } from "./index.js"

function sessionWithTask() {
  const session = SessionManager.inMemory()
  session.appendMessage({ role: "user", content: "Build accounting import", timestamp: 0 })
  return session
}

test("when a title is generated, persist its normalized auto-owned value", async () => {
  // Arrange
  const sessionManager = sessionWithTask()

  // Act
  await retitleFromCompaction({}, { sessionManager }, {
    generateTitle: async () => "  Accounting import  ",
  })

  // Assert
  assert.equal(sessionManager.getSessionName(), "Accounting import")
  assert.equal(sessionManager.titleSource, "auto")
})

test("when generations complete out of order, keep the latest request's title", async () => {
  // Arrange
  const sessionManager = sessionWithTask()
  const generation = Promise.withResolvers()
  const older = retitleFromCompaction({}, { sessionManager }, {
    generateTitle: () => generation.promise,
  })

  // Act
  await retitleFromCompaction({}, { sessionManager }, {
    generateTitle: async () => "Latest accounting goal",
  })
  generation.resolve("Outdated accounting goal")
  await older

  // Assert
  assert.equal(sessionManager.getSessionName(), "Latest accounting goal")
})

test("when a newer request produces no title, discard an older request's result", async () => {
  // Arrange
  const sessionManager = sessionWithTask()
  await sessionManager.setSessionName("Existing title", "auto")
  const generation = Promise.withResolvers()
  const older = retitleFromCompaction({}, { sessionManager }, {
    generateTitle: () => generation.promise,
  })

  // Act
  await retitleFromCompaction({}, { sessionManager }, { generateTitle: async () => null })
  generation.resolve("Outdated accounting goal")
  await older

  // Assert
  assert.equal(sessionManager.getSessionName(), "Existing title")
})

test("when the selected session changes during generation, discard the pending title", async () => {
  // Arrange
  const sessionManager = sessionWithTask()
  const generation = Promise.withResolvers()
  const pending = retitleFromCompaction({}, { sessionManager }, {
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
  const sessionManager = sessionWithTask()
  const originalLeaf = sessionManager.getLeafId()
  sessionManager.appendMessage({ role: "user", content: "Build a recipe blog instead", timestamp: 1 })
  const generation = Promise.withResolvers()
  const pending = retitleFromCompaction({}, { sessionManager }, {
    generateTitle: () => generation.promise,
  })

  // Act
  sessionManager.branch(originalLeaf)
  generation.resolve("Recipe blog")
  await pending

  // Assert
  assert.equal(sessionManager.getSessionName(), undefined)
})

test("when a manual rename happens during generation, preserve user ownership", async () => {
  // Arrange
  const sessionManager = sessionWithTask()
  const generation = Promise.withResolvers()
  const pending = retitleFromCompaction({}, { sessionManager }, {
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
  const sessionManager = sessionWithTask()
  await sessionManager.setSessionName("My chosen title", "user")

  // Act / Assert
  assert.equal(await retitleFromCompaction({}, { sessionManager }, {
    generateTitle: () => assert.fail("Manual titles must not request generation"),
  }), false)
})

test("when the generated title is unchanged, preserve title history", async () => {
  // Arrange
  const sessionManager = sessionWithTask()
  await sessionManager.setSessionName("Accounting import", "auto")
  const entries = sessionManager.getEntries()

  // Act
  await retitleFromCompaction({}, { sessionManager }, {
    generateTitle: async () => " Accounting import ",
  })

  // Assert
  assert.deepEqual(sessionManager.getEntries(), entries)
})

test("when generated output is blank, preserve the existing title", async () => {
  // Arrange
  const sessionManager = sessionWithTask()
  await sessionManager.setSessionName("Existing title", "auto")

  // Act
  await retitleFromCompaction({}, { sessionManager }, { generateTitle: async () => " \n\t " })

  // Assert
  assert.equal(sessionManager.getSessionName(), "Existing title")
})

test("when separate sessions retitle concurrently, keep their requests independent", async () => {
  // Arrange
  const sessionManager = sessionWithTask()
  const otherSession = sessionWithTask()
  const generation = Promise.withResolvers()
  const pending = retitleFromCompaction({}, { sessionManager }, {
    generateTitle: () => generation.promise,
  })

  // Act
  await retitleFromCompaction({}, { sessionManager: otherSession }, {
    generateTitle: async () => "Other session goal",
  })
  generation.resolve("Accounting import")
  await pending

  // Assert
  assert.equal(sessionManager.getSessionName(), "Accounting import")
})

test("when generation fails, propagate the error and allow a later retitle", async () => {
  // Arrange
  const sessionManager = sessionWithTask()

  // Act / Assert
  await assert.rejects(retitleFromCompaction({}, { sessionManager }, {
    generateTitle: async () => {
      throw new Error("Generation failed")
    },
  }), /Generation failed/)

  await retitleFromCompaction({}, { sessionManager }, {
    generateTitle: async () => "Accounting import",
  })
  assert.equal(sessionManager.getSessionName(), "Accounting import")
})
