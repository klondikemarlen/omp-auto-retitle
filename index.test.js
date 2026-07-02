import assert from "node:assert/strict"
import { test } from "node:test"

import {
  canRetitle,
  setAutoSessionName,
  titleFromCompaction,
} from "./index.js"

test("titleFromCompaction prefers the first cleaned short summary line", () => {
  assert.equal(
    titleFromCompaction({
      shortSummary: "\n  ## <b>Fix login</b>  **now**  \nignore the rest",
      summary: "Fallback title",
    }),
    "Fix login now",
  )
})

test("titleFromCompaction falls back to cleaned summary when shortSummary has no title", () => {
  assert.equal(
    titleFromCompaction({
      shortSummary: "<br>",
      summary: "  `Recovered`   _session_   title  ",
    }),
    "Recovered session title",
  )
})

test("titleFromCompaction caps long generated titles", () => {
  assert.equal(
    titleFromCompaction({ shortSummary: "x".repeat(81) }),
    "x".repeat(80),
  )
})

test("canRetitle only allows untitled-source or auto-titled sessions", () => {
  assert.equal(canRetitle({}), true)
  assert.equal(canRetitle({ titleSource: "auto" }), true)
  assert.equal(canRetitle({ titleSource: "user" }), false)
  assert.equal(canRetitle({ titleSource: "manual" }), false)
})

test("setAutoSessionName uses sessionManager.setSessionName with auto source and trigger", async () => {
  const calls = []
  const sessionManager = {
    getSessionName: () => "Old title",
    setSessionName: (...args) => calls.push(args),
  }

  await setAutoSessionName(sessionManager, {}, "New title")

  assert.deepEqual(calls, [
    ["New title", "auto", "omp-auto-retitle:session_compact"],
  ])
})

test("setAutoSessionName skips unchanged titles", async () => {
  const sessionManager = {
    getSessionName: () => "Already right",
    setSessionName: () => assert.fail("unchanged title should not be retitled"),
  }

  assert.equal(await setAutoSessionName(sessionManager, {}, "Already right"), false)
})
