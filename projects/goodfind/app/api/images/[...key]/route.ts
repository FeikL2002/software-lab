import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ key: string[] }> },
) {
  const { key } = await context.params;
  const objectKey = key.map(decodeURIComponent).join("/");
  const media = (env as unknown as { MEDIA: R2Bucket }).MEDIA;
  const object = await media.get(objectKey);
  if (!object) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("cache-control", "public, max-age=3600");
  headers.set("etag", object.httpEtag);
  return new Response(object.body, { headers });
}
