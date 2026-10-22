import assert from "node:assert/strict"
import { test } from "node:test"

import { buildSessionTitleContext } from "../../src/context/session-context.js"
import { formatSessionTitle } from "../../src/context/title-format.js"

function contextFor(entries) {
  return { sessionManager: { getBranch: () => entries } }
}

function userMessage(content) {
  return { type: "message", message: { role: "user", content } }
}

test("when a ticket reference is beyond prose limits, preserve it with its description", () => {
  // Arrange
  const ctx = contextFor([
    userMessage(`Please update this workflow. ${"Background ".repeat(30)}\nImplement reconciliation import\nhttps://github.com/acme/bank/issues/150`),
  ])

  // Act
  const { input } = buildSessionTitleContext({}, ctx)

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
  const context = buildSessionTitleContext({}, ctx)

  // Assert
  assert.equal(context.reference, "acme/omp-auto-retitle #8")
})

test("when feedback contains only an image label, do not treat its index as a ticket", () => {
  // Arrange
  const ctx = contextFor([
    userMessage("[Image #1, 1568x1231] observe this title before/after"),
  ])

  // Act
  const context = buildSessionTitleContext({}, ctx)

  // Assert
  assert.equal(context.reference, "")
})

test("when an attachment label precedes a genuine short reference on the same line, keep the reference", () => {
  // Arrange
  const ctx = contextFor([
    userMessage("[Screenshot #1, 1568x1231] compare this with issue #8"),
  ])

  // Act
  const context = buildSessionTitleContext({}, ctx)

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
  const { input } = buildSessionTitleContext({}, ctx)

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
  const { input } = buildSessionTitleContext({}, ctx)

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
  const { input } = buildSessionTitleContext({}, ctx)

  // Assert
  assert.match(input, /FIN-314/)
  assert.match(input, /Improve import matching for bank statements/)
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
  const context = buildSessionTitleContext({}, ctx)
  const title = formatSessionTitle("Reconcile bank statements", context, "{prefix}{description}")

  // Assert
  assert.equal(title, "FIN-314: Reconcile bank statements")
})

test("when a GitHub issue belongs to the working repository, keep its compact identity", () => {
  // Arrange
  const ctx = { cwd: "/workspace/omp-verifier", ...contextFor([
    userMessage("Review https://github.com/acme/omp-verifier/issues/150"),
  ]) }
  const context = buildSessionTitleContext({}, ctx)

  // Act
  const title = formatSessionTitle("Reassess advisor repairs", context, "{prefix}{description}")

  // Assert
  assert.equal(title, "omp-verifier #150: Reassess advisor repairs")
})

test("when a user names a pull request without a URL, retain its identity", () => {
  // Arrange
  const ctx = { cwd: "/workspace/ledger", ...contextFor([
    userMessage("Review PR #42 for duplicate imports"),
  ]) }
  const context = buildSessionTitleContext({}, ctx)

  // Act
  const title = formatSessionTitle("Prevent duplicate imports", context, "{prefix}{description}")

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
  const { input } = buildSessionTitleContext({}, ctx)

  // Assert
  assert.match(input, /acme\/bank #150: Reconcile statement imports/)
})
