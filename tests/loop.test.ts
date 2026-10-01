import { describe, expect, it, vi } from "vitest";
import type {
  ContentBlockParam,
  MessageParam,
  Tool,
} from "@anthropic-ai/sdk/resources/messages";
import {
  messageJoiner,
  pruneOldImages,
  runToolLoop,
  type ModelClient,
  type ToolLoopOptions,
} from "../src/main/ai/loop";
import type {
  RegisteredTool,
  ToolOutcome,
  ToolRegistry,
} from "../src/main/ai/tools";

// --- Test helpers -----------------------------------------------------------

function text(t: string): ContentBlockParam {
  return { type: "text", text: t };
}

function toolUse(
  id: string,
  name: string,
  input: unknown = {},
): ContentBlockParam {
  return { type: "tool_use", id, name, input };
}

function definition(name: string): Tool {
  return { name, input_schema: { type: "object", properties: {} } };
}

function registry(
  entries: Record<string, Partial<RegisteredTool>>,
): ToolRegistry {
  const map: ToolRegistry = new Map();
  for (const [name, tool] of Object.entries(entries)) {
    map.set(name, {
      definition: definition(name),
      execute: () => ({ content: "ok" }),
      ...tool,
    });
  }
  return map;
}

/**
 * A fake model client that replays scripted responses in order (the last one
 * repeats), emitting text deltas and tool_use blocks like the real stream.
 */
function fakeModel(responses: ContentBlockParam[][]) {
  const calls: MessageParam[][] = [];
  const client: ModelClient = async (messages, handlers) => {
    calls.push(messages);
    const content =
      responses[Math.min(calls.length - 1, responses.length - 1)]!;
    for (const block of content) {
      if (block.type === "text") handlers.onTextDelta(block.text);
      if (block.type === "tool_use") {
        handlers.onToolUseStart?.(block.name);
        handlers.onToolUse(block.id, block.name, block.input);
      }
    }
    return content;
  };
  return { client, calls };
}

function options(overrides: Partial<ToolLoopOptions>): ToolLoopOptions {
  return {
    callModel: fakeModel([[text("unused")]]).client,
    tools: new Map(),
    history: [],
    userContent: [text("question")],
    maxModelCalls: 6,
    signal: new AbortController().signal,
    onTextDelta: () => {},
    ...overrides,
  };
}

/** The tool_result blocks of the loop's last tool_result turn. */
function lastToolResults(turns: MessageParam[]) {
  const turn = [...turns]
    .reverse()
    .find(
      (t) =>
        Array.isArray(t.content) &&
        t.content.some((b) => b.type === "tool_result"),
    );
  return (turn!.content as ContentBlockParam[]).filter(
    (b) => b.type === "tool_result",
  );
}

// --- Tests -------------------------------------------------------------------

describe("runToolLoop", () => {
  it("text-only response: one model call, text streamed, no tool turns", async () => {
    const model = fakeModel([[text("Hello there.")]]);
    const deltas: string[] = [];
    const result = await runToolLoop(
      options({ callModel: model.client, onTextDelta: (d) => deltas.push(d) }),
    );

    expect(model.calls.length).toBe(1);
    expect(deltas.join("")).toBe("Hello there.");
    expect(result.stopReason).toBe("done");
    expect(result.turns.map((t) => t.role)).toEqual(["user", "assistant"]);
  });

  it("one tool call: result is sent back and the loop continues", async () => {
    const model = fakeModel([
      [toolUse("tu_1", "lookup", { q: "weather" })],
      [text("It is sunny.")],
    ]);
    const result = await runToolLoop(
      options({
        callModel: model.client,
        tools: registry({
          lookup: { execute: () => ({ content: "sunny, 21C" }) },
        }),
      }),
    );

    expect(model.calls.length).toBe(2);
    // The second model call saw the tool result.
    const secondCallLast = model.calls[1]!.at(-1)!
      .content as ContentBlockParam[];
    expect(secondCallLast[0]).toMatchObject({
      type: "tool_result",
      tool_use_id: "tu_1",
      content: "sunny, 21C",
    });
    expect(result.stopReason).toBe("done");
    expect(result.turns.map((t) => t.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
  });

  it("parallel tool calls: all executed, results in tool_use order", async () => {
    const model = fakeModel([
      [
        text("Checking both."),
        toolUse("tu_a", "alpha"),
        toolUse("tu_b", "beta"),
      ],
      [text("Done.")],
    ]);
    const result = await runToolLoop(
      options({
        callModel: model.client,
        tools: registry({
          alpha: { execute: async () => ({ content: "A" }) },
          beta: { execute: async () => ({ content: "B" }) },
        }),
      }),
    );

    expect(lastToolResults(result.turns)).toMatchObject([
      { tool_use_id: "tu_a", content: "A" },
      { tool_use_id: "tu_b", content: "B" },
    ]);
  });

  it("immediate tools run during streaming and are not executed twice", async () => {
    const execute = vi.fn((): ToolOutcome => ({ content: "drawn" }));
    const responses = [
      [toolUse("tu_1", "point", { x: 1, y: 2 })],
      [text("There it is.")],
    ];
    let call = 0;
    let executedDuringStream = false;
    const client: ModelClient = async (_messages, handlers) => {
      const content = responses[call++]!;
      for (const block of content) {
        if (block.type === "tool_use")
          handlers.onToolUse(block.id, block.name, block.input);
      }
      // The tool must have run before this model call even resolves.
      if (call === 1) executedDuringStream = execute.mock.calls.length === 1;
      return content;
    };
    const result = await runToolLoop(
      options({
        callModel: client,
        tools: registry({ point: { immediate: true, execute } }),
      }),
    );

    expect(executedDuringStream).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(lastToolResults(result.turns)[0]).toMatchObject({
      tool_use_id: "tu_1",
      content: "drawn",
    });
  });

  it("a turn cut off at the token ceiling stops as truncated, not done", async () => {
    const client: ModelClient = async (_messages, handlers) => {
      handlers.onTextDelta("I'll write the whole poem out n");
      handlers.onTruncated?.();
      return [text("I'll write the whole poem out n")];
    };
    const result = await runToolLoop(options({ callModel: client }));

    expect(result.stopReason).toBe("truncated");
  });

  it("a truncated turn that still called a tool keeps going", async () => {
    const model = fakeModel([[toolUse("tu_1", "lookup")], [text("Done.")]]);
    const client: ModelClient = async (messages, handlers, signal) => {
      const content = await model.client(messages, handlers, signal);
      if (model.calls.length === 1) handlers.onTruncated?.();
      return content;
    };
    const result = await runToolLoop(
      options({ callModel: client, tools: registry({ lookup: {} }) }),
    );

    expect(model.calls.length).toBe(2);
    expect(result.stopReason).toBe("done");
  });

  it("a tool error becomes an is_error result and the loop continues", async () => {
    const model = fakeModel([
      [toolUse("tu_1", "flaky")],
      [text("That did not work.")],
    ]);
    const result = await runToolLoop(
      options({
        callModel: model.client,
        tools: registry({
          flaky: {
            execute: () => {
              throw new Error("boom");
            },
          },
        }),
      }),
    );

    expect(model.calls.length).toBe(2);
    expect(lastToolResults(result.turns)[0]).toMatchObject({
      tool_use_id: "tu_1",
      content: "boom",
      is_error: true,
    });
    expect(result.stopReason).toBe("done");
  });

  it("an unknown tool returns an error result", async () => {
    const model = fakeModel([
      [toolUse("tu_1", "nonexistent")],
      [text("Oops.")],
    ]);
    const result = await runToolLoop(options({ callModel: model.client }));

    expect(lastToolResults(result.turns)[0]).toMatchObject({
      content: "Unknown tool: nonexistent",
      is_error: true,
    });
  });

  it("stops at the step limit without executing the final tool calls", async () => {
    const execute = vi.fn(() => ({ content: "ok" }));
    const model = fakeModel([[toolUse("tu", "lookup")]]); // always asks for the tool
    const result = await runToolLoop(
      options({
        callModel: model.client,
        tools: registry({ lookup: { execute } }),
        maxModelCalls: 3,
      }),
    );

    expect(model.calls.length).toBe(3);
    expect(execute).toHaveBeenCalledTimes(2); // not on the final call
    expect(result.stopReason).toBe("limit");
    expect(lastToolResults(result.turns)[0]).toMatchObject({
      content: "Step limit reached; this tool call was not executed.",
      is_error: true,
    });
    // History stays valid: every tool_use still got a tool_result.
    expect(result.turns.at(-1)!.role).toBe("user");
  });

  it("cancellation mid-tool aborts the loop and returns no turns", async () => {
    const controller = new AbortController();
    let toolSawAbort = false;
    const model = fakeModel([
      [toolUse("tu_1", "slow")],
      [text("never reached")],
    ]);
    const result = await runToolLoop(
      options({
        callModel: model.client,
        signal: controller.signal,
        tools: registry({
          slow: {
            execute: (_input, signal) =>
              new Promise((resolve) => {
                controller.abort();
                toolSawAbort = signal.aborted;
                resolve({ content: "too late" });
              }),
          },
        }),
      }),
    );

    expect(result.stopReason).toBe("aborted");
    expect(result.turns).toEqual([]);
    expect(toolSawAbort).toBe(true);
    expect(model.calls.length).toBe(1); // no further model calls after abort
  });

  it("cancellation during the model call aborts before recording anything", async () => {
    const controller = new AbortController();
    const client: ModelClient = async () => {
      controller.abort();
      return [text("ignored")];
    };
    const result = await runToolLoop(
      options({ callModel: client, signal: controller.signal }),
    );

    expect(result.stopReason).toBe("aborted");
    expect(result.turns).toEqual([]);
  });

  it("speaks the slow-tool filler once, even across multiple slow tools", async () => {
    const onSlowTool = vi.fn();
    const slowExecute = () =>
      new Promise<ToolOutcome>((resolve) =>
        setTimeout(() => resolve({ content: "ok" }), 30),
      );
    const model = fakeModel([
      [toolUse("tu_1", "slow")],
      [toolUse("tu_2", "slow")],
      [text("Done.")],
    ]);
    await runToolLoop(
      options({
        callModel: model.client,
        tools: registry({ slow: { execute: slowExecute } }),
        onSlowTool,
        slowToolMs: 10,
      }),
    );

    expect(onSlowTool).toHaveBeenCalledTimes(1);
  });

  it("does not fire the slow-tool filler for fast tools", async () => {
    const onSlowTool = vi.fn();
    const model = fakeModel([[toolUse("tu_1", "fast")], [text("Done.")]]);
    await runToolLoop(
      options({
        callModel: model.client,
        tools: registry({ fast: { execute: () => ({ content: "ok" }) } }),
        onSlowTool,
        slowToolMs: 50,
      }),
    );

    expect(onSlowTool).not.toHaveBeenCalled();
  });

  it("reports tool activity: as each block streams, as each executes, null at batch end", async () => {
    const model = fakeModel([
      [toolUse("tu_1", "lookup"), toolUse("tu_2", "read_window")],
      [text("Done.")],
    ]);
    const activity: Array<string | null> = [];
    await runToolLoop(
      options({
        callModel: model.client,
        tools: registry({ lookup: {}, read_window: {} }),
        onToolActivity: (name) => activity.push(name),
      }),
    );

    // Stream starts first, execution repeats the names (the caller dedupes),
    // and null marks the batch done — the model is thinking again.
    expect(activity).toEqual(["lookup", "read_window", "lookup", "read_window", null]);
  });

  it("stays silent while a tool waits on the user (propose_task, ask_user)", async () => {
    const onSlowTool = vi.fn();
    const model = fakeModel([[toolUse("tu_1", "propose_task")], [text("Done.")]]);
    await runToolLoop(
      options({
        callModel: model.client,
        tools: registry({
          propose_task: {
            waitsForUser: true,
            execute: () =>
              new Promise<ToolOutcome>((resolve) =>
                setTimeout(() => resolve({ content: "approved" }), 30),
              ),
          },
        }),
        onSlowTool,
        slowToolMs: 10,
      }),
    );

    expect(onSlowTool).not.toHaveBeenCalled();
  });
});

describe("batched tool calls (computer-use semantics)", () => {
  it("executes a batch strictly in order, never concurrently", async () => {
    const events: string[] = [];
    const slowThenFast = (name: string, delay: number): Partial<RegisteredTool> => ({
      execute: async () => {
        events.push(`${name}:start`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        events.push(`${name}:end`);
        return { content: "ok" };
      },
    });
    const model = fakeModel([
      [toolUse("tu_a", "first"), toolUse("tu_b", "second")],
      [text("Done.")],
    ]);
    await runToolLoop(
      options({
        callModel: model.client,
        tools: registry({ first: slowThenFast("first", 30), second: slowThenFast("second", 0) }),
      }),
    );

    expect(events).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });

  it("halts the batch at the first error when haltBatchOnError is set", async () => {
    const second = vi.fn(() => ({ content: "ok" }));
    const model = fakeModel([
      [toolUse("tu_a", "fails"), toolUse("tu_b", "works")],
      [text("Done.")],
    ]);
    const result = await runToolLoop(
      options({
        callModel: model.client,
        haltBatchOnError: true,
        tools: registry({
          fails: {
            execute: () => {
              throw new Error("nope");
            },
          },
          works: { execute: second },
        }),
      }),
    );

    expect(second).not.toHaveBeenCalled();
    const [first, skipped] = lastToolResults(result.turns);
    expect(first).toMatchObject({ is_error: true, content: "nope" });
    expect(skipped).toMatchObject({
      is_error: true,
      content: "Not executed: an earlier action in this batch failed.",
    });
  });

  it("a tool outcome with endLoop ends the loop after its batch (task_complete)", async () => {
    const model = fakeModel([
      [toolUse("tu_done", "task_complete", { summary: "All set", success: true })],
      [text("never reached")],
    ]);
    const result = await runToolLoop(
      options({
        callModel: model.client,
        tools: registry({
          task_complete: { execute: () => ({ content: "ok", endLoop: true }) },
        }),
      }),
    );

    expect(model.calls.length).toBe(1); // no model call after the end
    expect(result.stopReason).toBe("done");
    // History stays valid: the tool_use still got its tool_result.
    expect(lastToolResults(result.turns)[0]).toMatchObject({
      tool_use_id: "tu_done",
      content: "ok",
    });
  });

  it("skips the rest of the batch after an endLoop outcome", async () => {
    const after = vi.fn(() => ({ content: "ok" }));
    const model = fakeModel([
      [toolUse("tu_done", "task_complete"), toolUse("tu_x", "left_click")],
      [text("never reached")],
    ]);
    const result = await runToolLoop(
      options({
        callModel: model.client,
        tools: registry({
          task_complete: { execute: () => ({ content: "ok", endLoop: true }) },
          left_click: { execute: after },
        }),
      }),
    );

    expect(after).not.toHaveBeenCalled();
    expect(lastToolResults(result.turns)[1]).toMatchObject({
      tool_use_id: "tu_x",
      content: "Not executed: the task already ended.",
      is_error: true,
    });
  });

  it("without haltBatchOnError, later tools still run after an error", async () => {
    const second = vi.fn(() => ({ content: "ok" }));
    const model = fakeModel([
      [toolUse("tu_a", "fails"), toolUse("tu_b", "works")],
      [text("Done.")],
    ]);
    await runToolLoop(
      options({
        callModel: model.client,
        tools: registry({
          fails: {
            execute: () => {
              throw new Error("nope");
            },
          },
          works: { execute: second },
        }),
      }),
    );

    expect(second).toHaveBeenCalledTimes(1);
  });

  it("stops after a spoken drawing instead of taking another model call", async () => {
    const model = fakeModel([
      [text("That's the send button."), toolUse("tu_draw", "draw")],
      [text("never reached")],
    ]);
    const result = await runToolLoop(
      options({
        callModel: model.client,
        stopAfterSpokenDraw: true,
        tools: registry({ draw: { execute: () => ({ content: "Drew 1 shape(s): s1." }) } }),
      }),
    );

    expect(model.calls.length).toBe(1);
    expect(result.stopReason).toBe("done");
    expect(lastToolResults(result.turns)[0]).toMatchObject({ content: "Drew 1 shape(s): s1." });
  });

  it("keeps going when a drawing reply has not spoken yet", async () => {
    const model = fakeModel([
      [toolUse("tu_draw", "draw")],
      [text("That's the send button.")],
    ]);
    const result = await runToolLoop(
      options({
        callModel: model.client,
        stopAfterSpokenDraw: true,
        tools: registry({ draw: { execute: () => ({ content: "Drew 1 shape(s): s1." }) } }),
      }),
    );

    expect(model.calls.length).toBe(2);
    expect(result.stopReason).toBe("done");
  });
});

describe("pruneOldImages (agent screenshot history)", () => {
  // Untyped helper so it fits both message content and tool_result content.
  const image = (data: string) => ({
    type: "image" as const,
    source: { type: "base64" as const, media_type: "image/jpeg" as const, data },
  });
  const resultWithImage = (id: string, data: string): ContentBlockParam => ({
    type: "tool_result",
    tool_use_id: id,
    content: [{ type: "text", text: "acted" }, image(data)],
  });

  it("keeps only the N most recent images across turns and tool_results", () => {
    const turns: MessageParam[] = [
      { role: "user", content: [text("task"), image("shot-0")] },
      { role: "assistant", content: [toolUse("t1", "left_click")] },
      { role: "user", content: [resultWithImage("t1", "shot-1")] },
      { role: "assistant", content: [toolUse("t2", "type")] },
      { role: "user", content: [resultWithImage("t2", "shot-2")] },
      { role: "assistant", content: [toolUse("t3", "key")] },
      { role: "user", content: [resultWithImage("t3", "shot-3")] },
    ];
    pruneOldImages(turns, 3);

    const allImages = turns.flatMap((turn) =>
      (turn.content as ContentBlockParam[]).flatMap((block) => {
        if (block.type === "image") return [block.source];
        if (block.type === "tool_result" && Array.isArray(block.content)) {
          return block.content.filter((b) => b.type === "image").map((b) => b.source);
        }
        return [];
      }),
    );
    expect(allImages.map((s) => (s.type === "base64" ? s.data : ""))).toEqual([
      "shot-1",
      "shot-2",
      "shot-3",
    ]);
    // The oldest image became a placeholder; other text is untouched.
    expect(turns[0]!.content).toEqual([text("task"), { type: "text", text: "[screenshot omitted]" }]);
    const firstResult = (turns[2]!.content as ContentBlockParam[])[0]!;
    expect(firstResult.type).toBe("tool_result");
  });

  it("does nothing when there are fewer images than the limit", () => {
    const turns: MessageParam[] = [{ role: "user", content: [text("task"), image("only")] }];
    pruneOldImages(turns, 3);
    expect((turns[0]!.content as ContentBlockParam[])[1]).toEqual(image("only"));
  });
});

// A real transcript: "Let me look at our past conversations." then a lookup,
// "Let me check that conversation." then another, then the answer. The prompt
// forbids the narration and the model chains lookups anyway, so the loop has
// to be what keeps it out of the user's ears.
describe("runToolLoop speakOnlyAnswers", () => {
  const run = (responses: ContentBlockParam[][], tools: ToolRegistry) => {
    const deltas: string[] = [];
    const result = runToolLoop(
      options({
        callModel: fakeModel(responses).client,
        tools,
        speakOnlyAnswers: true,
        onTextDelta: (d) => deltas.push(d),
      }),
    );
    return result.then(() => deltas.join(""));
  };

  it("drops text before a lookup and speaks only the answer", async () => {
    const heard = await run(
      [
        [text("Let me look at our past conversations."), toolUse("tu_1", "list_conversations")],
        [text("Let me check that conversation."), toolUse("tu_2", "read_conversation")],
        [text("Veja Esplars, in white.")],
      ],
      registry({ list_conversations: {}, read_conversation: {} }),
    );
    expect(heard).toBe("Veja Esplars, in white.");
  });

  // The dropped narration must leave the model's context too. Left in, the
  // model believes it already answered ("Here are five picks…") and says
  // nothing after the tabs open, so the turn ends silent.
  it("removes dropped narration from the turns the model sees next", async () => {
    const model = fakeModel([
      [text("Here are the picks I found."), toolUse("tu_1", "browser_tabs")],
      [text("Five picks, best match first.")],
    ]);
    const result = await runToolLoop(
      options({
        callModel: model.client,
        tools: registry({ browser_tabs: {} }),
        speakOnlyAnswers: true,
      }),
    );
    const assistantTurns = model.calls[1]!.filter((turn) => turn.role === "assistant");
    expect(assistantTurns).toEqual([{ role: "assistant", content: [toolUse("tu_1", "browser_tabs")] }]);
    expect(result.turns.filter((turn) => turn.role === "assistant")).toHaveLength(2);
    expect(result.turns[1]!.content).toEqual([toolUse("tu_1", "browser_tabs")]);
  });

  it("keeps text alongside an immediate or spokenAlongside tool", async () => {
    const heard = await run(
      [[text("The export button is here."), toolUse("tu_1", "draw")], [text("Done.")]],
      registry({ draw: { immediate: true } }),
    );
    expect(heard).toBe("The export button is here.\n\nDone.");
    const ack = await run(
      [[text("Sure, check the plan."), toolUse("tu_1", "propose_task")], [text("")]],
      registry({ propose_task: { spokenAlongside: true } }),
    );
    expect(ack).toBe("Sure, check the plan.");
  });

  it("streams a plain answer untouched, and stays off by default", async () => {
    expect(await run([[text("Hello "), text("there.")]], new Map())).toBe("Hello there.");
    const deltas: string[] = [];
    await runToolLoop(
      options({
        callModel: fakeModel([[text("Let me check."), toolUse("tu_1", "lookup")], [text("Sunny.")]]).client,
        tools: registry({ lookup: {} }),
        onTextDelta: (d) => deltas.push(d),
      }),
    );
    expect(deltas.join("")).toBe("Let me check.\n\nSunny.");
  });
});

describe("messageJoiner", () => {
  it("breaks between messages so the caption never runs sentences together", () => {
    const out: string[] = [];
    const text = messageJoiner((delta) => out.push(delta));
    text.nextMessage();
    text.emit("That's your play button.");
    text.nextMessage();
    text.emit("Just click it.");
    text.nextMessage();
    text.emit(" Already spaced.");
    expect(out.join("")).toBe("That's your play button.\n\nJust click it. Already spaced.");
  });

  it("adds nothing before the first words, even after a silent call", () => {
    const out: string[] = [];
    const text = messageJoiner((delta) => out.push(delta));
    text.nextMessage();
    text.nextMessage();
    text.emit("Hi.");
    expect(out.join("")).toBe("Hi.");
  });
});
