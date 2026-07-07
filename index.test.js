import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import autoRetitleExtension, {
  canRetitle,
  generateTitleWithOmp,
  retitleFromCompaction,
  setAutoSessionName,
  titleInputFromCompaction,
  titleInputFromSession,
} from "./index.js"


test("package pins the coding agent compatibility version", () => {
  const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"))

  assert.equal(pkg.dependencies["@oh-my-pi/pi-coding-agent"], "16.3.11")
})

test("titleInputFromCompaction selects the first compaction text for title generation", () => {
  assert.equal(
    titleInputFromCompaction({
      shortSummary: "\n  ## <b>Fix login</b>  **now**  \nignore the rest",
      summary: "Fallback title",
    }),
    "## <b>Fix login</b>  **now**",
  )
})

test("titleInputFromCompaction falls back to summary text", () => {
  assert.equal(
    titleInputFromCompaction({
      shortSummary: "\n  \n",
      summary: "  Recovered session title  \nignore the rest",
    }),
    "Recovered session title",
  )
})

test("canRetitle only allows untitled-source or auto-titled sessions", () => {
  assert.equal(canRetitle({}), true)
  assert.equal(canRetitle({ titleSource: "auto" }), true)
  assert.equal(canRetitle({ titleSource: "user" }), false)
  assert.equal(canRetitle({ titleSource: "manual" }), false)
})

test("setAutoSessionName uses the auto source and compaction trigger", async () => {
  const calls = []
  const sessionManager = {
    getSessionName: () => "Old title",
    setSessionName: (...args) => calls.push(args),
  }

  await setAutoSessionName(sessionManager, "New title")
  assert.deepEqual(calls, [
    ["New title", "auto", "omp-auto-retitle:session_compact"],
  ])
})

test("setAutoSessionName skips unchanged titles", async () => {
  const sessionManager = {
    getSessionName: () => "Already right",
    setSessionName: () => assert.fail("unchanged title should not be retitled"),
  }

  assert.equal(await setAutoSessionName(sessionManager, "Already right"), false)
})

test("setAutoSessionName skips blank titles after trimming", async () => {
  const sessionManager = {
    setSessionName: () => assert.fail("blank title should not be retitled"),
  }

  assert.equal(await setAutoSessionName(sessionManager, " \n\t "), false)
})

test("titleInputFromSession keeps durable context for title generation", () => {
  const input = titleInputFromSession(
    { compactionEntry: { shortSummary: "Review generated reports" } },
    {
      sessionManager: {
        getBranch: () => [
          { type: "message", message: { role: "user", content: "\n\n" } },
          { type: "message", message: { role: "user", content: "Build the accounting import" } },
          { type: "compaction", shortSummary: "Connect to bank API" },
          { type: "compaction", shortSummary: "Map bank CSV columns" },
          { type: "compaction", shortSummary: "Normalize merchant names" },
          { type: "compaction", shortSummary: "Detect duplicate transactions" },
          { type: "compaction", shortSummary: "Reconcile opening balances" },
          {
            type: "message",
            message: { role: "user", content: "Set package version to 0.7" },
          },
        ],
      },
    },
  )

  assert.equal(
    input,
    [
      "Generate an intelligent session title for the overall session task over time. Prefer durable user goals, final deliverables, repeated concepts, and explicit title feedback over temporary implementation details.",
      "Original user request:\nBuild the accounting import",
      "Recent user context:\n- Set package version to 0.7",
      "Compaction history:\n- Map bank CSV columns\n- Normalize merchant names\n- Detect duplicate transactions\n- Reconcile opening balances\n- Review generated reports",
    ].join("\n\n"),
  )
  assert.doesNotMatch(input, /Connect to bank API/)
})

test("titleInputFromSession includes later clarified goals and title feedback", () => {
  const input = titleInputFromSession(
    { compactionEntry: { shortSummary: "Produced the WRAP Parallel QA VM Proposal document" } },
    {
      sessionManager: {
        getBranch: () => [
          { type: "message", message: { role: "user", content: "Draft a WRAP deployment note" } },
          {
            type: "message",
            message: {
              role: "user",
              content: "Actually, the durable topic is parallel QA environments for agent-driven development.",
            },
          },
          {
            type: "message",
            message: {
              role: "user",
              content: "A better title is:\n\nParallel QA Environments for Agent-Driven Development",
            },
          },
        ],
      },
    },
  )

  assert.equal(
    input,
    [
      "Generate an intelligent session title for the overall session task over time. Prefer durable user goals, final deliverables, repeated concepts, and explicit title feedback over temporary implementation details.",
      "Original user request:\nDraft a WRAP deployment note",
      "Recent user context:\n- Actually, the durable topic is parallel QA environments for agent-driven development.\n- A better title is: Parallel QA Environments for Agent-Driven Development",
      "Compaction history:\n- Produced the WRAP Parallel QA VM Proposal document",
    ].join("\n\n"),
  )
})

test("titleInputFromSession preserves latest repeated user context", () => {
  const input = titleInputFromSession(
    {},
    {
      sessionManager: {
        getBranch: () => [
          { type: "message", message: { role: "user", content: "Initial request" } },
          { type: "message", message: { role: "user", content: "Title feedback A" } },
          { type: "message", message: { role: "user", content: "Title feedback B" } },
          { type: "message", message: { role: "user", content: "Title feedback C" } },
          { type: "message", message: { role: "user", content: "Title feedback D" } },
          { type: "message", message: { role: "user", content: "Title feedback E" } },
          { type: "message", message: { role: "user", content: "Title feedback F" } },
          { type: "message", message: { role: "user", content: "Title feedback A" } },
        ],
      },
    },
  )

  assert.match(input, /Recent user context:\n- Title feedback C\n- Title feedback D\n- Title feedback E\n- Title feedback F\n- Title feedback A/)
})

test("retitleFromCompaction passes stable session input to the injected title generator", async () => {
  const calls = []
  const sessionManager = {
    titleSource: "auto",
    getBranch: () => [
      { type: "message", message: { role: "user", content: "Fix checkout totals" } },
      { type: "message", message: { role: "user", content: "Actually write a recipe blog" } },
      { type: "compaction", shortSummary: "Investigated tax rounding" },
    ],
    getSessionName: () => "Old title",
    setSessionName: (...args) => calls.push(args),
  }
  const ctx = { model: "fake-model", sessionManager }
  const event = {
    compactionEntry: {
      shortSummary: "\n  Found discount order bug  \n",
      summary: "Fallback",
    },
  }

  await retitleFromCompaction(event, ctx, {
    generateTitle: async (input, receivedCtx) => {
      assert.equal(
        input,
        [
          "Generate an intelligent session title for the overall session task over time. Prefer durable user goals, final deliverables, repeated concepts, and explicit title feedback over temporary implementation details.",
          "Original user request:\nFix checkout totals",
          "Recent user context:\n- Actually write a recipe blog",
          "Compaction history:\n- Investigated tax rounding\n- Found discount order bug",
        ].join("\n\n"),
      )
      assert.equal(receivedCtx, ctx)
      return "  **Generated by fake**  "
    },
  })

  assert.deepEqual(calls, [
    ["**Generated by fake**", "auto", "omp-auto-retitle:session_compact"],
  ])
})

test("retitleFromCompaction skips user-titled sessions before title generation", async () => {
  const sessionManager = {
    titleSource: "user",
    setSessionName: () => assert.fail("manual titles should not be retitled"),
  }

  assert.equal(
    await retitleFromCompaction(
      { compactionEntry: { shortSummary: "Should not be used" } },
      { sessionManager },
      {
        generateTitle: () => assert.fail("manual titles should not generate a title"),
      },
    ),
    false,
  )
})

test("retitleFromCompaction skips blank generated titles after trimming", async () => {
  const sessionManager = {
    titleSource: "auto",
    getBranch: () => [
      { type: "message", message: { role: "user", content: "Fix checkout totals" } },
    ],
    setSessionName: () => assert.fail("blank generated title should not be retitled"),
  }

  assert.equal(
    await retitleFromCompaction({}, { sessionManager }, { generateTitle: async () => " \n\t " }),
    false,
  )
})

test("autoRetitleExtension registers and runs compaction retitles", async () => {
  const events = new Map()
  const commands = new Map()
  const renamed = []
  const pi = {
    setLabel: (label) => assert.equal(label, "Auto Retitle"),
    on: (eventName, handler) => events.set(eventName, handler),
    registerCommand: (name, command) => commands.set(name, command),
  }
  const ctx = {
    sessionManager: {
      getBranch: () => [
        { type: "message", message: { role: "user", content: "Fix checkout totals" } },
      ],
      getSessionName: () => "Old title",
      setSessionName: (...args) => renamed.push(args),
    },
  }

  autoRetitleExtension(pi, {
    generateTitle: async (input) => {
      assert.equal(
        input,
        [
          "Generate an intelligent session title for the overall session task over time. Prefer durable user goals, final deliverables, repeated concepts, and explicit title feedback over temporary implementation details.",
          "Original user request:\nFix checkout totals",
          "Compaction history:\n- Found discount order bug",
        ].join("\n\n"),
      )
      return "Checkout totals"
    },
  })

  assert.equal(typeof events.get("session_compact"), "function")
  assert.equal(typeof commands.get("retitle")?.handler, "function")

  await events.get("session_compact")(
    { compactionEntry: { shortSummary: "Found discount order bug" } },
    ctx,
  )

  assert.deepEqual(renamed, [["Checkout totals", "auto", "omp-auto-retitle:session_compact"]])
})

test("retitle command notifies when the generated title changes", async () => {
  const commands = new Map()
  const notifications = []
  const renamed = []
  const pi = {
    setLabel: () => {},
    on: () => {},
    registerCommand: (name, command) => commands.set(name, command),
  }
  const ctx = {
    ui: { notify: (...args) => notifications.push(args) },
    sessionManager: {
      titleSource: "auto",
      getBranch: () => [
        { type: "message", message: { role: "user", content: "Fix checkout totals" } },
      ],
      getSessionName: () => "Old title",
      setSessionName: (...args) => {
        renamed.push(args)
      },
    },
  }

  autoRetitleExtension(pi, {
    generateTitle: async (input) => {
      assert.equal(
        input,
        [
          "Generate an intelligent session title for the overall session task over time. Prefer durable user goals, final deliverables, repeated concepts, and explicit title feedback over temporary implementation details.",
          "Original user request:\nFix checkout totals",
        ].join("\n\n"),
      )
      return "Checkout totals"
    },
  })

  await commands.get("retitle").handler([{ compactionEntry: { shortSummary: "ignored" } }], ctx)

  assert.deepEqual(renamed, [["Checkout totals", "auto", "omp-auto-retitle:session_compact"]])
  assert.deepEqual(notifications, [["Session title regenerated", "info"]])
})

test("retitle command notifies when the generated title is unchanged", async () => {
  const commands = new Map()
  const notifications = []
  const pi = {
    setLabel: () => {},
    on: () => {},
    registerCommand: (name, command) => commands.set(name, command),
  }
  const ctx = {
    ui: { notify: (...args) => notifications.push(args) },
    sessionManager: {
      titleSource: "auto",
      getBranch: () => [
        { type: "message", message: { role: "user", content: "Fix checkout totals" } },
      ],
      getSessionName: () => "Checkout totals",
      setSessionName: () => assert.fail("unchanged title should not be retitled"),
    },
  }

  autoRetitleExtension(pi, {
    generateTitle: async () => "Checkout totals",
  })

  await commands.get("retitle").handler([], ctx)

  assert.deepEqual(notifications, [["Session title unchanged", "info"]])
})

test("generateTitleWithOmp skips when host settings are unavailable", async () => {
  assert.equal(await generateTitleWithOmp("Title me", { sessionManager: {} }, undefined), null)
})
