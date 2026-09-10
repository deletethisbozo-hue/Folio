export class SerialSaveQueue<Key> {
  private readonly tails = new Map<Key, Promise<void>>();

  /** Run writes for one key strictly in request order. A rejected older write
   * never poisons the queue: the next edit is still allowed to save. Different
   * section keys remain independent. */
  async run<T>(key: Key, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    const tail = current.then(() => undefined, () => undefined);
    this.tails.set(key, tail);
    try {
      return await current;
    } finally {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }

  /** Resolve when every currently queued key has settled. */
  async flush(): Promise<void> {
    await Promise.all(Array.from(this.tails.values()));
  }
}
