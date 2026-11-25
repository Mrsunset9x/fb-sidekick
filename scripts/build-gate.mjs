/** Publish only after every bundle has a successful result and none is rebuilding. */
export class BuildGate {
  #states;
  #revision = 0;

  constructor(count) {
    this.#states = Array.from({ length: count }, () => ({ running: false, files: null }));
  }

  start(index) {
    this.#revision++;
    this.#states[index].running = true;
  }

  finish(index, result) {
    this.#revision++;
    this.#states[index] = { running: false, files: result.errors.length ? null : result.outputFiles };
  }

  snapshot() {
    if (this.#states.some((state) => state.running || !state.files)) return null;
    return { revision: this.#revision, files: this.#states.flatMap((state) => state.files) };
  }

  isCurrent(snapshot) {
    return snapshot.revision === this.#revision && !!this.snapshot();
  }
}
