import { mailCallback } from "@/lib/mail-auth";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  const { provider } = await context.params;
  return mailCallback(request, provider);
}
