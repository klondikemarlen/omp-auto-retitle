import assert from "node:assert/strict"
import { test } from "node:test"

import { titleInputFromCompaction, titleInputFromSession } from "./title-context.js"

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
  const input = titleInputFromSession({}, ctx)

  // Assert
  assert.match(input, /Original user request:\nProject: Build accounting import/)
})

test("when a compaction summary is multiline, retain the goal after its heading", () => {
  // Arrange
  const entry = { summary: "## Summary\n\nBuild accounting import" }

  // Act / Assert
  assert.equal(titleInputFromCompaction(entry), "## Summary Build accounting import")
})

test("when the short summary is blank, use the full compaction summary", () => {
  // Arrange
  const entry = { shortSummary: " \n ", summary: "Completed accounting import" }

  // Act / Assert
  assert.equal(titleInputFromCompaction(entry), "Completed accounting import")
})

test("when every context source is long, retain all sources within OMP's input budget", () => {
  // Arrange
  const ctx = contextFor([
    userMessage("Original accounting goal " + "O".repeat(3000)),
    ...Array.from({ length: 5 }, (_, i) => userMessage(`Recent goal ${i} ` + "U".repeat(300))),
    ...Array.from({ length: 5 }, (_, i) => ({
      type: "compaction", summary: `Completed deliverable ${i} ` + "C".repeat(3000),
    })),
  ])

  // Act
  const input = titleInputFromSession({}, ctx)

  // Assert
  assert.ok(input.length <= 2000, `Title prompt exceeds OMP's budget: ${input.length}`)
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
  const input = titleInputFromSession(event, ctx)

  // Assert
  assert.ok(input.endsWith("Compaction history:\n- Goal C\n- Goal D\n- Goal E\n- Goal F\n- Goal A"))
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
  const input = titleInputFromSession({}, ctx)

  // Assert
  assert.ok(input.endsWith("Recent user context:\n- Goal C\n- Goal D\n- Goal E\n- Goal F\n- Goal A"))
})

test("when messages mix roles and content types, include only user text", () => {
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
  const input = titleInputFromSession({}, ctx)

  // Assert
  assert.match(input, /Original user request:\nBuild accounting import/)
  assert.match(input, /Recent user context:\n- Final goal: Bank reconciliation/)
  assert.doesNotMatch(input, /noise/)
})

test("when history contains abandoned branches, use only the selected branch", () => {
  // Arrange
  const ctx = { sessionManager: {
    getBranch: () => [userMessage("Current branch goal")],
    getEntries: () => [userMessage("Abandoned goal")],
  } }

  // Act
  const input = titleInputFromSession({}, ctx)

  // Assert
  assert.match(input, /Current branch goal/)
  assert.doesNotMatch(input, /Abandoned goal/)
})

test("when the session is empty, return no title input", () => {
  // Arrange
  const ctx = contextFor([])

  // Act / Assert
  assert.equal(titleInputFromSession({}, ctx), "")
})
