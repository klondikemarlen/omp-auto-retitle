import assert from "node:assert/strict"
import { test } from "node:test"

import { buildSessionTitleContext, getCompactionSummary } from "../../src/context/session-context.js"

function contextFor(entries) {
  return { sessionManager: { getBranch: () => entries } }
}

function userMessage(content) {
  return { type: "message", message: { role: "user", content } }
}

test("when an original request is multiline, retain the goal after its heading", () => {
  // Arrange
  const ctx = contextFor([
    userMessage("\nProject:\n\nBuild accounting import"),
  ])

  // Act
  const { input } = buildSessionTitleContext({}, ctx)

  // Assert
  assert.match(input, /Build accounting import/)
})

test("when a compaction summary is multiline, retain the goal after its heading", () => {
  // Arrange
  const entry = { summary: "## Summary\n\nBuild accounting import" }

  // Act / Assert
  assert.equal(getCompactionSummary(entry), "## Summary Build accounting import")
})

test("when the short summary is blank, use the full compaction summary", () => {
  // Arrange
  const entry = { shortSummary: " \n ", summary: "Completed accounting import" }

  // Act / Assert
  assert.equal(getCompactionSummary(entry), "Completed accounting import")
})

test("when every context source is long, retain all sources within OMP's input budget", () => {
  // Arrange
  const ctx = {
    cwd: "/workspace/" + "R".repeat(100),
    ...contextFor([
      userMessage("Original accounting goal " + "O".repeat(3000)),
      ...Array.from({ length: 5 }, (_, i) => userMessage(`Recent goal ${i} ` + "U".repeat(300))),
      ...Array.from({ length: 5 }, (_, i) => ({
        type: "compaction", summary: `Completed deliverable ${i} ` + "C".repeat(3000),
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        type: "message",
        message: { role: "toolResult", content: `https://github.com/acme/bank/issues/${150 + i} ${"D".repeat(300)}` },
      })),
    ]),
  }

  // Act
  const { input } = buildSessionTitleContext({}, ctx)

  // Assert
  assert.ok(input.length <= 2000, `Title prompt exceeds OMP's budget: ${input.length}`)
  assert.match(input, /bank #150/)
  assert.match(input, /bank #151/)
  assert.match(input, /bank #152/)
  assert.match(input, /Original accounting goal/)
  for (let i = 0; i < 5; i += 1) {
    assert.ok(input.includes(`Recent goal ${i}`))
    assert.ok(input.includes(`Completed deliverable ${i}`))
  }
})

test("when compaction summaries repeat, retain their latest chronological occurrences", () => {
  // Arrange
  const event = { compactionEntry: { summary: "Goal A" } }
  const ctx = contextFor([
    { type: "compaction", summary: "Goal A" },
    { type: "compaction", summary: "Goal B" },
    { type: "compaction", summary: "Goal C" },
    { type: "compaction", summary: "Goal D" },
    { type: "compaction", summary: "Goal E" },
    { type: "compaction", summary: "Goal F" },
    { type: "compaction", summary: "Goal A" },
  ])

  // Act
  const { input } = buildSessionTitleContext(event, ctx)

  // Assert
  assert.doesNotMatch(input, /Goal B/)
  assert.match(input, /Goal C[\s\S]*Goal D[\s\S]*Goal E[\s\S]*Goal F[\s\S]*Goal A/)
})

test("when user feedback repeats, retain its latest chronological occurrences", () => {
  // Arrange
  const ctx = contextFor([
    userMessage("Original goal"),
    userMessage("Goal A"), userMessage("Goal B"), userMessage("Goal C"),
    userMessage("Goal D"), userMessage("Goal E"), userMessage("Goal F"),
    userMessage("Goal A"),
  ])

  // Act
  const { input } = buildSessionTitleContext({}, ctx)

  // Assert
  assert.doesNotMatch(input, /Goal B/)
  assert.match(input, /Goal C[\s\S]*Goal D[\s\S]*Goal E[\s\S]*Goal F[\s\S]*Goal A/)
})

test("when messages mix roles and content types, use user text and relevant work references", () => {
  // Arrange
  const ctx = contextFor([
    userMessage(" \n "),
    { type: "message", message: { role: "assistant", content: "Assistant-only noise" } },
    userMessage([
      { type: "text", text: "Build accounting import" },
      { type: "image", data: "image-only noise" },
    ]),
    userMessage([{ type: "text", text: "Final goal:" }, { type: "text", text: "Bank reconciliation" }]),
  ])

  // Act
  const { input } = buildSessionTitleContext({}, ctx)

  // Assert
  assert.match(input, /Build accounting import/)
  assert.match(input, /Final goal: Bank reconciliation/)
  assert.doesNotMatch(input, /noise/)
})

test("when cwd identifies a project, include its repository name", () => {
  // Arrange
  const ctx = { cwd: "/workspace/accounting-import", ...contextFor([userMessage("Build imports")]) }

  // Act
  const { input } = buildSessionTitleContext({}, ctx)

  // Assert
  assert.match(input, /accounting-import/)
})

test("when cwd is unavailable, use the session manager working directory", () => {
  // Arrange
  const ctx = {
    sessionManager: {
      getBranch: () => [userMessage("Build imports")],
      getCwd: () => "/workspace/bank-reconciler",
    },
  }

  // Act
  const { input } = buildSessionTitleContext({}, ctx)

  // Assert
  assert.match(input, /bank-reconciler/)
})

test("when history contains abandoned branches, use only the selected branch", () => {
  // Arrange
  const ctx = { sessionManager: {
    getBranch: () => [userMessage("Current branch goal")],
    getEntries: () => [userMessage("Abandoned goal")],
  } }

  // Act
  const { input } = buildSessionTitleContext({}, ctx)

  // Assert
  assert.match(input, /Current branch goal/)
  assert.doesNotMatch(input, /Abandoned goal/)
})
test("when the triggering summary is not yet in history, retain its late ticket details", () => {
  // Arrange
  const ctx = contextFor([userMessage("Review the remaining work")])
  const event = { compactionEntry: { summary: "Background ".repeat(100) + "\nFIN-314 Reconcile bank statements" } }

  // Act
  const { input } = buildSessionTitleContext(event, ctx)

  // Assert
  assert.match(input, /FIN-314:.*Reconcile bank statements/)
})

test("when the session is empty, cwd alone does not create title input", () => {
  // Arrange
  const ctx = { cwd: "/workspace/bank-reconciler", ...contextFor([]) }

  // Act / Assert
  assert.equal(buildSessionTitleContext({}, ctx), null)
})
