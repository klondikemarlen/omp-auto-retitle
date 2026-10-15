import assert from "node:assert/strict"
import { test } from "node:test"

import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager"

import { retitleFromCompaction } from "./index.js"

function sessionWithTask() {
  const session = SessionManager.inMemory()
  session.appendMessage({ role: "user", content: "Build accounting import", timestamp: 0 })
  return session
}

test("retitling persists a normalized auto title", async () => {
  const sessionManager = sessionWithTask()

  await retitleFromCompaction({}, { sessionManager }, {
    generateTitle: async () => "  Accounting import  ",
  })

  assert.equal(sessionManager.getSessionName(), "Accounting import")
  assert.equal(sessionManager.titleSource, "auto")
})

test("an older generation cannot overwrite the latest title", async () => {
  const sessionManager = sessionWithTask()
  const generation = Promise.withResolvers()
  const older = retitleFromCompaction({}, { sessionManager }, {
    generateTitle: () => generation.promise,
  })

  await retitleFromCompaction({}, { sessionManager }, {
    generateTitle: async () => "Latest accounting goal",
  })
  generation.resolve("Outdated accounting goal")
  await older

  assert.equal(sessionManager.getSessionName(), "Latest accounting goal")
})

test("a newer request without a title still supersedes an older request", async () => {
  const sessionManager = sessionWithTask()
  await sessionManager.setSessionName("Existing title", "auto")
  const generation = Promise.withResolvers()
  const older = retitleFromCompaction({}, { sessionManager }, {
    generateTitle: () => generation.promise,
  })

  await retitleFromCompaction({}, { sessionManager }, { generateTitle: async () => null })
  generation.resolve("Outdated accounting goal")
  await older

  assert.equal(sessionManager.getSessionName(), "Existing title")
})

test("a pending generation cannot rename a newly selected session", async () => {
  const sessionManager = sessionWithTask()
  const generation = Promise.withResolvers()
  const pending = retitleFromCompaction({}, { sessionManager }, {
    generateTitle: () => generation.promise,
  })

  await sessionManager.newSession()
  generation.resolve("Previous session title")
  await pending

  assert.equal(sessionManager.getSessionName(), undefined)
})

test("a pending generation cannot rename a different branch", async () => {
  const sessionManager = sessionWithTask()
  const originalLeaf = sessionManager.getLeafId()
  sessionManager.appendMessage({ role: "user", content: "Build a recipe blog instead", timestamp: 1 })
  const generation = Promise.withResolvers()
  const pending = retitleFromCompaction({}, { sessionManager }, {
    generateTitle: () => generation.promise,
  })

  sessionManager.branch(originalLeaf)
  generation.resolve("Recipe blog")
  await pending

  assert.equal(sessionManager.getSessionName(), undefined)
})

test("a manual rename during generation remains authoritative", async () => {
  const sessionManager = sessionWithTask()
  const generation = Promise.withResolvers()
  const pending = retitleFromCompaction({}, { sessionManager }, {
    generateTitle: () => generation.promise,
  })

  await sessionManager.setSessionName("My chosen title", "user")
  generation.resolve("Generated title")
  await pending

  assert.equal(sessionManager.getSessionName(), "My chosen title")
  assert.equal(sessionManager.titleSource, "user")
})

test("manual titles skip generation entirely", async () => {
  const sessionManager = sessionWithTask()
  await sessionManager.setSessionName("My chosen title", "user")

  assert.equal(await retitleFromCompaction({}, { sessionManager }, {
    generateTitle: () => assert.fail("Manual titles must not request generation"),
  }), false)
})

test("unchanged titles do not append another title history entry", async () => {
  const sessionManager = sessionWithTask()
  await sessionManager.setSessionName("Accounting import", "auto")
  const entries = sessionManager.getEntries()

  await retitleFromCompaction({}, { sessionManager }, {
    generateTitle: async () => " Accounting import ",
  })

  assert.deepEqual(sessionManager.getEntries(), entries)
})

test("blank generated output preserves the existing title", async () => {
  const sessionManager = sessionWithTask()
  await sessionManager.setSessionName("Existing title", "auto")

  await retitleFromCompaction({}, { sessionManager }, { generateTitle: async () => " \n\t " })

  assert.equal(sessionManager.getSessionName(), "Existing title")
})

test("independent sessions do not supersede each other's requests", async () => {
  const sessionManager = sessionWithTask()
  const otherSession = sessionWithTask()
  const generation = Promise.withResolvers()
  const pending = retitleFromCompaction({}, { sessionManager }, {
    generateTitle: () => generation.promise,
  })

  await retitleFromCompaction({}, { sessionManager: otherSession }, {
    generateTitle: async () => "Other session goal",
  })
  generation.resolve("Accounting import")
  await pending

  assert.equal(sessionManager.getSessionName(), "Accounting import")
})

test("generation errors propagate and do not prevent a later retitle", async () => {
  const sessionManager = sessionWithTask()

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
