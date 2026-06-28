// Standard JSON envelope, matching brightdata-cli. Data to stdout, errors exit(1).

export function ok(data: unknown, opts: { pretty?: boolean } = {}): void {
  const envelope = { ok: true, data };
  console.log(opts.pretty ? JSON.stringify(envelope, null, 2) : JSON.stringify(envelope));
}

export function err(message: string, code?: string): never {
  const envelope: { ok: false; error: string; code?: string } = { ok: false, error: message };
  if (code) envelope.code = code;
  console.log(JSON.stringify(envelope));
  process.exit(1);
}
