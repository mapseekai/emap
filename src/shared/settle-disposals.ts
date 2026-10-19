/** Await all cleanup barriers; one failure must not skip another resource. */
export async function settleDisposals(work: readonly (void | PromiseLike<void>)[]): Promise<void> {
  const results = await Promise.allSettled(work);
  const errors = results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason as unknown] : [],
  );
  if (errors.length) throw new AggregateError(errors, 'Resource disposal failed; retry disposal.');
}
