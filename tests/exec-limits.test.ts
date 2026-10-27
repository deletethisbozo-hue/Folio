import assert from "node:assert/strict";
import { run } from "../server/pipeline/exec.ts";
const code = await run(process.execPath, ["-e", "process.stdout.write('result'); process.exitCode=7"]);
assert.equal(code.code, 7);
assert.equal(code.stdout, "result");
await assert.rejects(run(process.execPath, ["-e", "setInterval(()=>{},1000)"], { timeoutMs: 100 }), /timed out/);
await assert.rejects(run(process.execPath, ["-e", "process.stdout.write('x'.repeat(4096))"], { maxOutputBytes: 100 }), /exceeded/);
console.log("4 passed, 0 failed");
