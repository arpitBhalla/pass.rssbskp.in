/** Runs once when the server starts, before it takes requests. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { ready } = await import('./server/startup');
  // If the database can't be reached now, the server still starts (the reason is printed) and each
  // request tries again: failing here would fail every request until the server restarts.
  await ready().catch(() => {});
}
