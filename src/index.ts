// dsh-frecency plugin entry. The tool surface lands in the implementation
// phase: a resident @ff-labs/fff-node FileFinder singleton plus same-name
// grep/glob shadow registration with presentation reuse (docs/design.md §4).
export const name = "dsh-frecency";

export const inject = ["tools"] as const;

export function apply(_ctx: unknown): void {
  // TODO(implementation): create the FileFinder singleton and register
  // grep/glob via ctx.tools.register (scoped tools shadow globals); fall
  // back to the built-in ripgrep tools when the native engine is unavailable.
  throw new Error("dsh-frecency: implementation not started (scaffold only)");
}
