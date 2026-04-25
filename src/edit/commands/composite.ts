import type { EditCommand } from '../edit-command';

/**
 * Wraps an ordered list of child commands in a single undoable step.
 *
 * `do()` invokes the children in their declared order; `undo()` invokes them
 * in reverse order. This is the building block for every multi-step user
 * operation (e.g. delete-many, future clip / dissolve / batch attribute
 * changes) — one logical action becomes one history entry.
 */
export class CompositeCommand implements EditCommand {
  readonly label: string | undefined;

  constructor(
    private readonly children: ReadonlyArray<EditCommand>,
    label?: string,
  ) {
    this.label = label;
  }

  do(): void {
    for (const child of this.children) {
      child.do();
    }
  }

  undo(): void {
    // Reverse order so the last-applied mutation is reverted first; that is
    // the only order in which each child's captured indices stay valid.
    for (let i = this.children.length - 1; i >= 0; i--) {
      this.children[i].undo();
    }
  }
}
