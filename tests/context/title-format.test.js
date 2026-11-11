import assert from "node:assert/strict"
import { test } from "node:test"

import { buildSessionTitleContext } from "../../src/context/session-context.js"
import { formatSessionTitle, getRequestTitleExcerpt } from "../../src/context/title-format.js"

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
  const title = formatSessionTitle("Reconcile bank imports", context, "{prefix}{description}{suffix}")

  // Assert
  assert.equal(title, "ACC-42: Reconcile bank imports — ledger")
})

test("when there is no ticket, title the question with its repository", () => {
  // Arrange
  const ctx = { cwd: "/workspace/ledger", ...contextFor([userMessage("How do duplicate transactions happen?")]) }
  const context = buildSessionTitleContext({}, ctx)

  // Act
  const title = formatSessionTitle("Explain duplicate transactions", context, "{prefix}{description}{suffix}")

  // Assert
  assert.equal(title, "Explain duplicate transactions — ledger")
})

test("when generation is blank, do not turn identity alone into a title", () => {
  // Arrange
  const context = { repository: "ledger", reference: "ACC-42" }

  // Act / Assert
  assert.equal(formatSessionTitle(" \n ", context, "{prefix}{description}{suffix}"), "")
})

test("when a title format places the ticket first, retain identifiers omitted by the model", () => {
  // Arrange
  const context = { repository: "ledger", reference: "PR#42" }

  // Act
  const title = formatSessionTitle("Prevent duplicate imports", context, "{reference} | {repository} | {description}")

  // Assert
  assert.equal(title, "PR#42 | ledger | Prevent duplicate imports")
})

test("when the default format has no identity, omit both optional separators", () => {
  // Arrange
  const context = { repository: "", reference: "" }

  // Act
  const title = formatSessionTitle("Explain transaction isolation", context, "{prefix}{description}{suffix}")

  // Assert
  assert.equal(title, "Explain transaction isolation")
})

test("when a ticket has no repository, omit the repository separator", () => {
  // Arrange
  const context = { reference: "WRAPX-123" }

  // Act
  const title = formatSessionTitle("Some Stuff", context, "{prefix}{description}{suffix}")

  // Assert
  assert.equal(title, "WRAPX-123: Some Stuff")
})

for (const [name, context, expected] of [
  ["a readable request", { originalTask: "Explain duplicate bank transactions" }, "Explain duplicate bank transactions"],
  ["a different ticket", { reference: "ACC-99", originalTask: "Fix the original import bug" }, ""],
  ["tracker metadata", { originalTask: '{"title":"Import failure"}' }, ""],
  ["a bare link", { originalTask: "https://example.com/task" }, ""],
  ["an acknowledgement", { originalTask: "Thanks!" }, ""],
  ["an oversized request", { originalTask: "Explain why importing bank statements creates duplicate transactions and how to prevent repeated rows without losing legitimate transfers" }, "Explain why importing bank statements creates duplicate transactions and how to prevent repeated rows without losing…"],
]) {
  test(`when fallback context contains ${name}, retain only a grounded bounded excerpt`, () => {
    // Act / Assert
    assert.equal(getRequestTitleExcerpt(context), expected)
  })
}
