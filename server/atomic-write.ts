import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Replace a UTF-8 file without exposing a partially-written target. Existing
 * permissions are retained where the host filesystem supports POSIX modes.
 *
 * We intentionally do not unlink the destination before rename: doing so would
 * create a data-loss window on Windows and defeat the reason this helper exists.
 */
export async function atomicWriteUtf8(target: string, content: string, _encoding: "utf8" = "utf8"): Promise<void> {
  const directory = path.dirname(target);
  await fs.mkdir(directory, { recursive: true });

  let mode = 0o600;
  try {
    mode = (await fs.stat(target)).mode & 0o777;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw error;
  }

  const temp = path.join(
    directory,
    `.${path.basename(target)}.${process.pid}.${randomUUID()}.folio-tmp`,
  );
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;

  try {
    handle = await fs.open(temp, "wx", mode);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;

    // Node's rename maps to the platform's replace operation for files. Do not
    // add an unlink(target) fallback: that would make crashes destructive.
    for (let attempt = 0; ; attempt += 1) {
      try {
        await fs.rename(temp, target);
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        const transientWindowsLock = process.platform === "win32" && (code === "EPERM" || code === "EBUSY" || code === "EACCES");
        if (!transientWindowsLock || attempt >= 6) throw error;
        await new Promise<void>((resolve) => setTimeout(resolve, 25 * (2 ** attempt)));
      }
    }

    // Best-effort directory sync strengthens crash durability on filesystems
    // that support it. Windows commonly rejects directory handles, which is
    // harmless because the file replacement has already completed.
    try {
      const directoryHandle = await fs.open(directory, "r");
      try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    } catch {
      // Unsupported by this filesystem/platform.
    }
  } finally {
    if (handle) await handle.close().catch(() => undefined);
    await fs.rm(temp, { force: true }).catch(() => undefined);
  }
}
