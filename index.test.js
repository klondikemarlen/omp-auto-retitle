import assert from "node:assert/strict"
import { test } from "node:test"

import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager"

import autoRetitleExtension, { retitleSession as actualRetitleSession } from "./index.js"

function retitleSession(event, ctx, options = {}, reason = "command") {
  return actualRetitleSession(event, ctx, {
    resolveTitlePrompt: defaultPromptPolicy,
    ...options,
  }, reason)
}

function defaultPromptPolicy() {
  return { systemPrompt: "Default test title prompt", format: "{prefix}{description}", custom: false, path: "default test prompt" }
}

function sessionWithTask() {
  const session = SessionManager.inMemory("/workspace/accounting")
  session.appendMessage({ role: "user", content: "Build accounting import", timestamp: 0 })
  return session
}

function extensionHarness(generateTitle, resolveTitlePrompt = defaultPromptPolicy) {
  const handlers = new Map()
  const commands = new Map()
  const notifications = []
  const pi = {
    setLabel() {},
    on(name, callback) { handlers.set(name, callback) },
    registerCommand(name, command) { commands.set(name, command) },
  }
  autoRetitleExtension(pi, { generateTitle, resolveTitlePrompt })
  return {
    handlers,
    commands,
    notifications,
    ctx(sessionManager) {
      return { sessionManager, ui: { notify: (...args) => notifications.push(args) } }
    },
  }
}

test("when a title is generated, persist its normalized auto-owned value", async () => {
  // Arrange
  const sessionManager = sessionWithTask()

  // Act
  await retitleSession({}, { sessionManager }, {
    generateTitle: async () => "  Accounting import  ",
  })

  // Assert
  assert.equal(sessionManager.getSessionName(), "accounting: Accounting import")
  assert.equal(sessionManager.titleSource, "auto")
})

test("when generations complete out of order, keep the latest request's title", async () => {
  // Arrange
  const sessionManager = sessionWithTask()
  const generation = Promise.withResolvers()
  const older = retitleSession({}, { sessionManager }, {
    generateTitle: () => generation.promise,
  })

  // Act
  await retitleSession({}, { sessionManager }, {
    generateTitle: async () => "Latest accounting goal",
  })
  generation.resolve("Outdated accounting goal")
  await older

  // Assert
  assert.equal(sessionManager.getSessionName(), "accounting: Latest accounting goal")
})

test("when a newer request produces no title, discard an older request's result", async () => {
  // Arrange
  const sessionManager = sessionWithTask()
  await sessionManager.setSessionName("Existing title", "auto")
  const generation = Promise.withResolvers()
  const older = retitleSession({}, { sessionManager }, {
    generateTitle: () => generation.promise,
  })

  // Act
  await retitleSession({}, { sessionManager }, { generateTitle: async () => null })
  generation.resolve("Outdated accounting goal")
  await older

  // Assert
  assert.equal(sessionManager.getSessionName(), "Existing title")
})

test("when the selected session changes during generation, discard the pending title", async () => {
  // Arrange
  const sessionManager = sessionWithTask()
  const generation = Promise.withResolvers()
  const pending = retitleSession({}, { sessionManager }, {
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
  const pending = retitleSession({}, { sessionManager }, {
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
  const sessionManager = sessionWithTask()
  const generation = Promise.withResolvers()
  const pending = retitleSession({}, { sessionManager }, {
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
  const sessionManager = sessionWithTask()
  const generation = Promise.withResolvers()
  const pending = retitleSession({}, { sessionManager }, {
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
  assert.equal(await retitleSession({}, { sessionManager }, {
    generateTitle: () => assert.fail("Manual titles must not request generation"),
  }), false)
})

test("when the generated title is unchanged, preserve title history", async () => {
  // Arrange
  const sessionManager = sessionWithTask()
  await sessionManager.setSessionName("accounting: Accounting import", "auto")
  const entries = sessionManager.getEntries()

  // Act
  await retitleSession({}, { sessionManager }, {
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
  await retitleSession({}, { sessionManager }, {
    generateTitle: async () => " \n\t ",
  })

  // Assert
  assert.equal(sessionManager.getSessionName(), "Existing title")
})

test("when separate sessions retitle concurrently, keep their requests independent", async () => {
  // Arrange
  const sessionManager = sessionWithTask()
  const otherSession = sessionWithTask()
  const generation = Promise.withResolvers()
  const pending = retitleSession({}, { sessionManager }, {
    generateTitle: () => generation.promise,
  })

  // Act
  await retitleSession({}, { sessionManager: otherSession }, {
    generateTitle: async () => "Other session goal",
  })
  generation.resolve("Accounting import")
  await pending

  // Assert
  assert.equal(sessionManager.getSessionName(), "accounting: Accounting import")
})

test("when generation fails, propagate the error and allow a later retitle", async () => {
  // Arrange
  const sessionManager = sessionWithTask()

  // Act / Assert
  await assert.rejects(retitleSession({}, { sessionManager }, {
    generateTitle: async () => {
      throw new Error("Generation failed")
    },
  }), /Generation failed/)

  await retitleSession({}, { sessionManager }, {
    generateTitle: async () => "Accounting import",
  })
  assert.equal(sessionManager.getSessionName(), "accounting: Accounting import")
})

test("when the first agent run completes, title once and skip unchanged followups", async () => {
  // Arrange
  const sessionManager = sessionWithTask()
  let generations = 0
  const harness = extensionHarness(async () => `Accounting task ${++generations}`)
  const ctx = harness.ctx(sessionManager)

  // Act
  await harness.handlers.get("agent_end")({}, ctx)
  await harness.handlers.get("agent_end")({}, ctx)

  // Assert
  assert.equal(generations, 1)
  assert.equal(sessionManager.getSessionName(), "accounting: Accounting task 1")
})

test("when the active ticket changes, retitle on the next completed agent run", async () => {
  // Arrange
  const sessionManager = sessionWithTask()
  let generations = 0
  const harness = extensionHarness(async () => `Ticket task ${++generations}`)
  const ctx = harness.ctx(sessionManager)
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
  const sessionManager = sessionWithTask()
  let generations = 0
  const harness = extensionHarness(async () => `Plan task ${++generations}`)
  const ctx = harness.ctx(sessionManager)
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
  assert.equal(sessionManager.getSessionName(), "accounting: Plan task 2")
})

test("when OMP writes a native auto title, restore the accepted title without generation", async () => {
  // Arrange
  const sessionManager = sessionWithTask()
  let generations = 0
  const harness = extensionHarness(async () => `Accounting task ${++generations}`)
  const ctx = harness.ctx(sessionManager)
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
  const sessionManager = sessionWithTask()
  let generations = 0
  const harness = extensionHarness(async () => `Generated task ${++generations}`)
  const ctx = harness.ctx(sessionManager)
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
  const sessionManager = sessionWithTask()
  const originalLeaf = sessionManager.getLeafId()
  const harness = extensionHarness(async () => "Accounting task")
  const ctx = harness.ctx(sessionManager)
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
  const sessionManager = sessionWithTask()
  const harness = extensionHarness(async () => "Accounting task")
  const ctx = harness.ctx(sessionManager)
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
  const sessionManager = sessionWithTask()
  const harness = extensionHarness(async () => "Accounting task")
  const ctx = harness.ctx(sessionManager)
  await harness.handlers.get("agent_end")({}, ctx)

  // Act
  sessionManager.appendMessage({ role: "user", content: "Switch to a recipe blog", timestamp: 1 })
  await sessionManager.setSessionName("Native title", "auto", "omp-native-auto-title")

  // Assert
  assert.equal(sessionManager.getSessionName(), "Native title")
})

test("when compaction or the command requests retitling, use the corresponding title trigger", async () => {
  // Arrange
  const sessionManager = sessionWithTask()
  let generations = 0
  const harness = extensionHarness(async () => `Explicit task ${++generations}`)
  const ctx = harness.ctx(sessionManager)

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

test("when a native title write occurs during newer generation, keep its interim value until commit", async () => {
  // Arrange
  const sessionManager = sessionWithTask()
  const generation = Promise.withResolvers()
  let calls = 0
  const harness = extensionHarness(() => {
    calls += 1
    return calls === 1 ? "Original task" : generation.promise
  })
  const ctx = harness.ctx(sessionManager)
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

test("when only title history changes during generation, keep the request fresh", async () => {
  // Arrange
  const sessionManager = sessionWithTask()
  const generation = Promise.withResolvers()
  const pending = retitleSession({}, { sessionManager }, {
    generateTitle: () => generation.promise,
  })

  // Act
  await sessionManager.setSessionName("Native interim title", "auto", "omp-native-auto-title")
  generation.resolve("Accounting import")
  await pending

  // Assert
  assert.equal(sessionManager.getSessionName(), "accounting: Accounting import")
  assert.equal(sessionManager.getEntries().filter((entry) => entry.type === "title_change").length, 2)
})

test("when a ticket supplies a subject, retain it across replans without a model call", async () => {
  // Arrange
  const sessionManager = sessionWithTask()
  sessionManager.appendMessage({ role: "user", content: "ACC-43: Fix transaction matching. Acknowledge with ready.", timestamp: 1 })
  const harness = extensionHarness(() => assert.fail("An explicit ticket subject does not need generation"))
  const ctx = harness.ctx(sessionManager)
  await harness.handlers.get("agent_end")({}, ctx)

  // Act
  sessionManager.appendMessage({ role: "user", content: "For ACC-43, initialize the investigation plan", timestamp: 2 })
  harness.handlers.get("tool_result")({ toolName: "todo", isError: false, details: { op: "init" } }, ctx)
  await harness.handlers.get("agent_end")({}, ctx)

  // Assert
  assert.equal(sessionManager.getSessionName(), "accounting ACC-43: Fix transaction matching")
})

test("when the active ticket changes, do not reuse another ticket's explicit subject", async () => {
  // Arrange
  const sessionManager = sessionWithTask()
  sessionManager.appendMessage({ role: "user", content: "ACC-42: Fix bank imports", timestamp: 1 })
  const harness = extensionHarness(async () => "Explain transaction isolation")
  const ctx = harness.ctx(sessionManager)
  await harness.handlers.get("agent_end")({}, ctx)

  // Act
  sessionManager.appendMessage({ role: "user", content: "Now work on ACC-43", timestamp: 2 })
  await harness.handlers.get("agent_end")({}, ctx)

  // Assert
  assert.equal(sessionManager.getSessionName(), "accounting ACC-43: Explain transaction isolation")
})

test("when an older title write finishes late, preserve the newer repair cache", async () => {
  // Arrange
  const sessionManager = sessionWithTask()
  const written = Promise.withResolvers()
  const persisted = Promise.withResolvers()
  const setName = sessionManager.setSessionName.bind(sessionManager)
  sessionManager.setSessionName = async (...args) => {
    const changed = await setName(...args)
    if (args[0] === "accounting: Original task") {
      written.resolve()
      await persisted.promise
    }
    return changed
  }
  const ctx = { sessionManager }
  const older = retitleSession({}, ctx, { generateTitle: async () => "Original task" })
  await written.promise
  await retitleSession({}, ctx, { generateTitle: async () => "Latest task" })

  // Act
  persisted.resolve()
  await older
  await sessionManager.setSessionName("Native generic title", "auto", "replan")

  // Assert
  assert.equal(sessionManager.getSessionName(), "accounting: Latest task")
})

test("when conversation progress defers an auto overwrite, repair at the same-task turn boundary", async () => {
  // Arrange
  const sessionManager = sessionWithTask()
  let generations = 0
  const harness = extensionHarness(async () => `Accounting task ${++generations}`)
  const ctx = harness.ctx(sessionManager)
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
  const sessionManager = sessionWithTask()
  const harness = extensionHarness(async () => "Accounting import")
  const ctx = harness.ctx(sessionManager)
  await harness.handlers.get("agent_end")({}, ctx)
  sessionManager.appendMessage({ role: "user", content: "ACC-43: Fix transaction matching", timestamp: 1 })
  await sessionManager.setSessionName("Native generic title", "auto", "replan")

  // Act
  await harness.handlers.get("agent_end")({}, ctx)

  // Assert
  assert.equal(sessionManager.getSessionName(), "accounting ACC-43: Fix transaction matching")
  assert.equal(sessionManager.getEntries().at(-1).trigger, "omp-auto-retitle:task")
})

test("when status inspects a deferred overwrite, report its cause without changing history", async () => {
  // Arrange
  const sessionManager = sessionWithTask()
  let generations = 0
  const harness = extensionHarness(async () => `Accounting task ${++generations}`)
  const ctx = harness.ctx(sessionManager)
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
  const sessionManager = sessionWithTask()
  await sessionManager.setSessionName("My chosen title", "user")
  const harness = extensionHarness(() => assert.fail("Status must not generate a title"))
  const ctx = harness.ctx(sessionManager)
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
  const sessionManager = sessionWithTask()
  const harness = extensionHarness(() => assert.fail("Unknown actions must not generate"))
  const ctx = harness.ctx(sessionManager)
  const entries = sessionManager.getEntries().slice()

  // Act
  await harness.commands.get("retitle").handler("stats", ctx)

  // Assert
  assert.deepEqual(sessionManager.getEntries(), entries)
  assert.match(harness.notifications.at(-1)[0], /Usage: \/retitle \[status\]/)
})

test("when a custom title policy is selected, persist its complete generated format", async () => {
  // Arrange
  const sessionManager = sessionWithTask()
  const harness = extensionHarness(async () => "OPS / BANKING / Import reconciliation", () => ({
    systemPrompt: "Custom title policy",
    custom: true,
    path: "project TITLE_SYSTEM.md",
  }))

  // Act
  await harness.handlers.get("agent_end")({}, harness.ctx(sessionManager))

  // Assert
  assert.equal(sessionManager.getSessionName(), "OPS / BANKING / Import reconciliation")
})

test("when a custom title policy is selected for a ticket, generate its complete format", async () => {
  // Arrange
  const sessionManager = sessionWithTask()
  sessionManager.appendMessage({ role: "user", content: "ACC-43: Fix transaction matching", timestamp: 1 })
  const harness = extensionHarness(async () => {
    return "FINANCE — Audit trail — Reconcile imported transactions"
  }, () => ({
    systemPrompt: "Custom title policy",
    custom: true,
    path: "project TITLE_SYSTEM.md",
  }))

  // Act
  await harness.handlers.get("agent_end")({}, harness.ctx(sessionManager))

  // Assert
  assert.equal(sessionManager.getSessionName(), "FINANCE — Audit trail — Reconcile imported transactions")
})

test("when a custom title request races a manual rename, preserve user ownership", async () => {
  // Arrange
  const sessionManager = sessionWithTask()
  const generation = Promise.withResolvers()
  const policy = {
    systemPrompt: "Custom title policy",
    custom: true,
    path: "project TITLE_SYSTEM.md",
  }
  const pending = actualRetitleSession({}, { sessionManager }, {
    resolveTitlePrompt: () => policy,
    generateTitle: () => generation.promise,
  })

  // Act
  await sessionManager.setSessionName("My chosen title", "user")
  generation.resolve("Custom complete title")
  await pending

  // Assert
  assert.equal(sessionManager.getSessionName(), "My chosen title")
  assert.equal(sessionManager.titleSource, "user")
})

test("when a custom title policy cannot be read, preserve the title and allow a later request", async () => {
  // Arrange
  const sessionManager = sessionWithTask()
  await sessionManager.setSessionName("Existing title", "auto")
  let readable = false
  const harness = extensionHarness(async () => "Later complete title", () => {
    if (!readable) throw new Error("TITLE_SYSTEM.md is unreadable")
    return {
      systemPrompt: "Custom title policy",
      custom: true,
      path: "project TITLE_SYSTEM.md",
    }
  })
  const ctx = harness.ctx(sessionManager)

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
  const sessionManager = sessionWithTask()
  sessionManager.appendMessage({ role: "user", content: "ACC-43: Fix transaction matching", timestamp: 1 })
  const harness = extensionHarness(async () => "Reconcile imported transactions", () => ({
    systemPrompt: "Describe the task",
    format: "{reference} | {repository} | {description}",
    custom: true,
    path: "project TITLE_SYSTEM.md",
  }))

  // Act
  await harness.handlers.get("agent_end")({}, harness.ctx(sessionManager))

  // Assert
  assert.equal(sessionManager.getSessionName(), "ACC-43 | accounting | Reconcile imported transactions")
})
