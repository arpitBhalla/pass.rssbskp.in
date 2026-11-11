/** Runs once when the server starts, before it takes requests. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startup } = await import('./server/startup');
  await startup();
}
