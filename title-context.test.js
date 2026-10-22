import assert from "node:assert/strict"
import { test } from "node:test"

import { titleInputFromCompaction, titleContextFromSession, titleWithFormat } from "./title-context.js"

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
  const { input } = titleContextFromSession({}, ctx)

  // Assert
  assert.match(input, /Build accounting import/)
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
  const { input } = titleContextFromSession({}, ctx)

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
  const { input } = titleContextFromSession(event, ctx)

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
  const { input } = titleContextFromSession({}, ctx)

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
  const { input } = titleContextFromSession({}, ctx)

  // Assert
  assert.match(input, /Build accounting import/)
  assert.match(input, /Final goal: Bank reconciliation/)
  assert.doesNotMatch(input, /noise/)
})

test("when cwd identifies a project, include its repository name", () => {
  // Arrange
  const ctx = { cwd: "/workspace/accounting-import", ...contextFor([userMessage("Build imports")]) }

  // Act
  const { input } = titleContextFromSession({}, ctx)

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
  const { input } = titleContextFromSession({}, ctx)

  // Assert
  assert.match(input, /bank-reconciler/)
})

test("when a ticket reference is beyond prose limits, preserve it with its description", () => {
  // Arrange
  const ctx = contextFor([
    userMessage(`Please update this workflow. ${"Background ".repeat(30)}\nImplement reconciliation import\nhttps://github.com/acme/bank/issues/150`),
  ])

  // Act
  const { input } = titleContextFromSession({}, ctx)

  // Assert
  assert.match(input, /acme\/bank #150/)
  assert.match(input, /Implement reconciliation import/)
})

test("when feedback mentions an image after the real issue, keep the issue reference", () => {
  // Arrange
  const ctx = contextFor([
    userMessage("Improve https://github.com/acme/omp-auto-retitle/issues/8\n[Image #1] observe this title before/after"),
  ])

  // Act
  const context = titleContextFromSession({}, ctx)

  // Assert
  assert.equal(context.reference, "acme/omp-auto-retitle #8")
})

test("when feedback contains only an image label, do not treat its index as a ticket", () => {
  // Arrange
  const ctx = contextFor([
    userMessage("[Image #1, 1568x1231] observe this title before/after"),
  ])

  // Act
  const context = titleContextFromSession({}, ctx)

  // Assert
  assert.equal(context.reference, "")
})

test("when an attachment label precedes a genuine short reference on the same line, keep the reference", () => {
  // Arrange
  const ctx = contextFor([
    userMessage("[Screenshot #1, 1568x1231] compare this with issue #8"),
  ])

  // Act
  const context = titleContextFromSession({}, ctx)

  // Assert
  assert.equal(context.reference, "#8")
})

test("when assistant or tool output identifies a pull request, include its evidence", () => {
  // Arrange
  const ctx = contextFor([
    userMessage("Fix bank reconciliation"),
    { type: "message", message: { role: "assistant", content: "Pull request for the import fix:\nhttps://github.com/acme/bank/pull/42" } },
    { type: "message", message: { role: "toolResult", content: "Reviewed PR https://github.com/acme/bank/pull/43 for statement matching" } },
    { type: "tool_call", arguments: { text: "https://github.com/acme/bank/issues/999" } },
  ])

  // Act
  const { input } = titleContextFromSession({}, ctx)

  // Assert
  assert.match(input, /acme\/bank PR#42/)
  assert.match(input, /acme\/bank PR#43/)
  assert.doesNotMatch(input, /999/)
})

test("when selected work switches tickets, exclude references from an abandoned branch", () => {
  // Arrange
  const ctx = {
    sessionManager: {
      getBranch: () => [
        userMessage("Implement the current task"),
        userMessage("Working on https://github.com/acme/bank/issues/202"),
      ],
      getEntries: () => [
        userMessage("Implement the current task"),
        userMessage("https://github.com/acme/bank/issues/101"),
      ],
    },
  }

  // Act
  const { input } = titleContextFromSession({}, ctx)

  // Assert
  assert.match(input, /issues\/202/)
  assert.doesNotMatch(input, /issues\/101/)
})

test("when a Jira key is present, retain the key and adjacent task description", () => {
  // Arrange
  const ctx = contextFor([
    userMessage("Build transaction reconciliation"),
    { type: "compaction", summary: "Completed initial analysis\nFIN-314 Improve import matching for bank statements" },
  ])

  // Act
  const { input } = titleContextFromSession({}, ctx)

  // Assert
  assert.match(input, /FIN-314/)
  assert.match(input, /Improve import matching for bank statements/)
})

test("when history contains abandoned branches, use only the selected branch", () => {
  // Arrange
  const ctx = { sessionManager: {
    getBranch: () => [userMessage("Current branch goal")],
    getEntries: () => [userMessage("Abandoned goal")],
  } }

  // Act
  const { input } = titleContextFromSession({}, ctx)

  // Assert
  assert.match(input, /Current branch goal/)
  assert.doesNotMatch(input, /Abandoned goal/)
})

test("when the session is empty, cwd alone does not create title input", () => {
  // Arrange
  const ctx = { cwd: "/workspace/bank-reconciler", ...contextFor([]) }

  // Act / Assert
  assert.equal(titleContextFromSession({}, ctx), null)
})

test("when later tools mention incidental tickets, preserve the user's selected work", () => {
  // Arrange
  const ctx = contextFor([
    userMessage("Context ".repeat(100) + "\nFIN-314 Reconcile bank statements"),
    ...Array.from({ length: 5 }, (_, i) => ({
      type: "message",
      message: { role: "toolResult", content: `https://github.com/acme/bank/issues/${i + 10} Related backlog` },
    })),
  ])

  // Act
  const context = titleContextFromSession({}, ctx)
  const title = titleWithFormat("Reconcile bank statements", context, "{prefix}{description}")

  // Assert
  assert.equal(title, "FIN-314: Reconcile bank statements")
})

test("when the triggering summary is not yet in history, retain its late ticket details", () => {
  // Arrange
  const ctx = contextFor([userMessage("Review the remaining work")])
  const event = { compactionEntry: { summary: "Background ".repeat(100) + "\nFIN-314 Reconcile bank statements" } }

  // Act
  const { input } = titleContextFromSession(event, ctx)

  // Assert
  assert.match(input, /FIN-314:.*Reconcile bank statements/)
})

test("when the model omits identifiers, retain repository and Jira identity in the title", () => {
  // Arrange
  const ctx = { cwd: "/workspace/ledger", ...contextFor([userMessage("Implement ACC-42: Reconcile bank imports")]) }
  const context = titleContextFromSession({}, ctx)

  // Act
  const title = titleWithFormat("Reconcile bank imports", context, "{prefix}{description}")

  // Assert
  assert.equal(title, "ledger ACC-42: Reconcile bank imports")
})

test("when there is no ticket, title the question with its repository", () => {
  // Arrange
  const ctx = { cwd: "/workspace/ledger", ...contextFor([userMessage("How do duplicate transactions happen?")]) }
  const context = titleContextFromSession({}, ctx)

  // Act
  const title = titleWithFormat("Explain duplicate transactions", context, "{prefix}{description}")

  // Assert
  assert.equal(title, "ledger: Explain duplicate transactions")
})

test("when generation is blank, do not turn identity alone into a title", () => {
  // Arrange
  const context = { repository: "ledger", reference: "ACC-42" }

  // Act / Assert
  assert.equal(titleWithFormat(" \n ", context, "{prefix}{description}"), "")
})

test("when a GitHub issue belongs to the working repository, keep its compact identity", () => {
  // Arrange
  const ctx = { cwd: "/workspace/omp-verifier", ...contextFor([
    userMessage("Review https://github.com/acme/omp-verifier/issues/150"),
  ]) }
  const context = titleContextFromSession({}, ctx)

  // Act
  const title = titleWithFormat("Reassess advisor repairs", context, "{prefix}{description}")

  // Assert
  assert.equal(title, "omp-verifier #150: Reassess advisor repairs")
})

test("when a user names a pull request without a URL, retain its identity", () => {
  // Arrange
  const ctx = { cwd: "/workspace/ledger", ...contextFor([
    userMessage("Review PR #42 for duplicate imports"),
  ]) }
  const context = titleContextFromSession({}, ctx)

  // Act
  const title = titleWithFormat("Prevent duplicate imports", context, "{prefix}{description}")

  // Assert
  assert.equal(title, "ledger PR#42: Prevent duplicate imports")
})

test("when a reference follows long single-line background, retain the nearby task description", () => {
  // Arrange
  const ctx = contextFor([
    userMessage("Review the current issue"),
    { type: "message", message: {
      role: "toolResult",
      content: "Background ".repeat(100) + "https://github.com/acme/bank/issues/150 Reconcile statement imports",
    } },
  ])

  // Act
  const { input } = titleContextFromSession({}, ctx)

  // Assert
  assert.match(input, /acme\/bank #150: Reconcile statement imports/)
})

test("when a title format places the ticket first, retain identifiers omitted by the model", () => {
  // Arrange
  const context = { repository: "ledger", reference: "PR#42" }

  // Act
  const title = titleWithFormat("Prevent duplicate imports", context, "{reference} | {repository} | {description}")

  // Assert
  assert.equal(title, "PR#42 | ledger | Prevent duplicate imports")
})

test("when the default format has no identity, omit the entire prefix", () => {
  // Arrange
  const context = { repository: "", reference: "" }

  // Act
  const title = titleWithFormat("Explain transaction isolation", context, "{prefix}{description}")

  // Assert
  assert.equal(title, "Explain transaction isolation")
})
