export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { runMigrations } = await import('./lib/db/migrations');
    try {
      await runMigrations();
    } catch (err) {
      console.error('[instrumentation] migrations failed:', err);
    }
  }
}
