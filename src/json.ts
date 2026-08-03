export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

export async function readJson<T>(request: Request): Promise<T> {
  return await request.json<T>();
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
