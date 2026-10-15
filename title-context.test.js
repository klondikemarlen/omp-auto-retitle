import assert from "node:assert/strict"
import { test } from "node:test"

import { titleInputFromCompaction, titleInputFromSession } from "./title-context.js"

function contextFor(entries) {
  return { sessionManager: { getBranch: () => entries } }
}

function userMessage(content) {
  return { type: "message", message: { role: "user", content } }
}

test("multiline original requests keep the goal after a heading", () => {
  const input = titleInputFromSession({}, contextFor([
    userMessage("\nProject:\n\nBuild accounting import"),
  ]))

  assert.match(input, /Original user request:\nProject: Build accounting import/)
})

test("multiline compaction summaries keep the goal after a heading", () => {
  assert.equal(titleInputFromCompaction({ summary: "## Summary\n\nBuild accounting import" }),
    "## Summary Build accounting import")
})

test("blank short summaries fall back to the full compaction summary", () => {
  assert.equal(titleInputFromCompaction({ shortSummary: " \n ", summary: "Completed accounting import" }),
    "Completed accounting import")
})

test("the full prompt preserves all context sources within OMP's input budget", () => {
  const input = titleInputFromSession({}, contextFor([
    userMessage("Original accounting goal " + "O".repeat(3000)),
    ...Array.from({ length: 5 }, (_, i) => userMessage(`Recent goal ${i} ` + "U".repeat(300))),
    ...Array.from({ length: 5 }, (_, i) => ({
      type: "compaction", summary: `Completed deliverable ${i} ` + "C".repeat(3000),
    })),
  ]))

  assert.ok(input.length <= 2000, `Title prompt exceeds OMP's budget: ${input.length}`)
  assert.match(input, /Original accounting goal/)
  for (let i = 0; i < 5; i += 1) {
    assert.ok(input.includes(`Recent goal ${i}`))
    assert.ok(input.includes(`Completed deliverable ${i}`))
  }
})

test("compaction history retains the latest occurrences in chronological order", () => {
  const input = titleInputFromSession({ compactionEntry: { summary: "Goal A" } }, contextFor([
    { type: "compaction", summary: "Goal A" },
    { type: "compaction", summary: "Goal B" },
    { type: "compaction", summary: "Goal C" },
    { type: "compaction", summary: "Goal D" },
    { type: "compaction", summary: "Goal E" },
    { type: "compaction", summary: "Goal F" },
    { type: "compaction", summary: "Goal A" },
  ]))

  assert.ok(input.endsWith("Compaction history:\n- Goal C\n- Goal D\n- Goal E\n- Goal F\n- Goal A"))
})

test("recent user context retains the latest clarification and title feedback", () => {
  const input = titleInputFromSession({}, contextFor([
    userMessage("Original goal"),
    userMessage("Goal A"), userMessage("Goal B"), userMessage("Goal C"),
    userMessage("Goal D"), userMessage("Goal E"), userMessage("Goal F"),
    userMessage("Goal A"),
  ]))

  assert.ok(input.endsWith("Recent user context:\n- Goal C\n- Goal D\n- Goal E\n- Goal F\n- Goal A"))
})

test("only text from user messages and compactions contributes to title context", () => {
  const input = titleInputFromSession({}, contextFor([
    userMessage(" \n "),
    { type: "message", message: { role: "assistant", content: "Assistant-only noise" } },
    userMessage([
      { type: "text", text: "Build accounting import" },
      { type: "image", data: "image-only noise" },
    ]),
    userMessage([{ type: "text", text: "Final goal:" }, { type: "text", text: "Bank reconciliation" }]),
  ]))

  assert.match(input, /Original user request:\nBuild accounting import/)
  assert.match(input, /Recent user context:\n- Final goal: Bank reconciliation/)
  assert.doesNotMatch(input, /noise/)
})

test("title context uses the selected branch rather than abandoned history", () => {
  const input = titleInputFromSession({}, { sessionManager: {
    getBranch: () => [userMessage("Current branch goal")],
    getEntries: () => [userMessage("Abandoned goal")],
  } })

  assert.match(input, /Current branch goal/)
  assert.doesNotMatch(input, /Abandoned goal/)
})

test("empty sessions have no title input", () => {
  assert.equal(titleInputFromSession({}, contextFor([])), "")
})
