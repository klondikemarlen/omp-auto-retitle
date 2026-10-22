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

test("when the model omits identifiers, retain repository and Jira identity in the title", () => {
  // Arrange
  const ctx = { cwd: "/workspace/ledger", ...contextFor([userMessage("Implement ACC-42: Reconcile bank imports")]) }
  const context = buildSessionTitleContext({}, ctx)

  // Act
  const title = formatSessionTitle("Reconcile bank imports", context, "{prefix}{description}")

  // Assert
  assert.equal(title, "ledger ACC-42: Reconcile bank imports")
})

test("when there is no ticket, title the question with its repository", () => {
  // Arrange
  const ctx = { cwd: "/workspace/ledger", ...contextFor([userMessage("How do duplicate transactions happen?")]) }
  const context = buildSessionTitleContext({}, ctx)

  // Act
  const title = formatSessionTitle("Explain duplicate transactions", context, "{prefix}{description}")

  // Assert
  assert.equal(title, "ledger: Explain duplicate transactions")
})

test("when generation is blank, do not turn identity alone into a title", () => {
  // Arrange
  const context = { repository: "ledger", reference: "ACC-42" }

  // Act / Assert
  assert.equal(formatSessionTitle(" \n ", context, "{prefix}{description}"), "")
})

test("when a title format places the ticket first, retain identifiers omitted by the model", () => {
  // Arrange
  const context = { repository: "ledger", reference: "PR#42" }

  // Act
  const title = formatSessionTitle("Prevent duplicate imports", context, "{reference} | {repository} | {description}")

  // Assert
  assert.equal(title, "PR#42 | ledger | Prevent duplicate imports")
})

test("when the default format has no identity, omit the entire prefix", () => {
  // Arrange
  const context = { repository: "", reference: "" }

  // Act
  const title = formatSessionTitle("Explain transaction isolation", context, "{prefix}{description}")

  // Assert
  assert.equal(title, "Explain transaction isolation")
})
