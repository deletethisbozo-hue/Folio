import { spawn } from "node:child_process";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run a command, optionally piping `input` to stdin. Never rejects on non-zero exit. */
export function run(
  command: string,
  args: string[],
  opts: { input?: string | Buffer; cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; maxOutputBytes?: number } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: opts.cwd, env: opts.env, windowsHide: true });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let settled = false;
    let bytes = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      child.kill();
      reject(error);
    };
    const capture = (target: Buffer[], chunk: Buffer) => {
      if (settled) return;
      bytes += chunk.length;
      if (opts.maxOutputBytes !== undefined && bytes > opts.maxOutputBytes) {
        fail(new Error(`Command output exceeded ${opts.maxOutputBytes} bytes.`));
        return;
      }
      target.push(chunk);
    };
    child.stdout.on("data", (chunk) => capture(out, chunk));
    child.stderr.on("data", (chunk) => capture(err, chunk));
    child.on("error", fail);
    child.stdin.on("error", (error: NodeJS.ErrnoException) => { if (error.code !== "EPIPE") fail(error); });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? -1, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") });
    });
    if (opts.timeoutMs !== undefined) {
      timer = setTimeout(() => fail(new Error(`Command timed out after ${opts.timeoutMs} ms.`)), opts.timeoutMs);
      timer.unref();
    }
    if (opts.input !== undefined) {
      child.stdin.write(opts.input);
    }
    child.stdin.end();
  });
}

/** Whether a command exists on PATH (used to detect optional tools like java). */
export async function commandExists(command: string): Promise<boolean> {
  try {
    const probe = process.platform === "win32" ? "where" : "which";
    const r = await run(probe, [command]);
    return r.code === 0;
  } catch {
    return false;
  }
}
