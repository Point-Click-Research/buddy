// Which tool batch is executing. A batch is every tool call one model reply
// made at once; the loop bumps this before running each one. Tools that must
// pace themselves to the model's words (a rundown's tabs) read it to tell
// "second call in the same reply" from "next step".

let batch = 0;

export function beginToolBatch(): void {
  batch++;
}

export function currentToolBatch(): number {
  return batch;
}
