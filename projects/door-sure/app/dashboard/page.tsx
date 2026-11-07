import { chatGPTSignOutPath, requireChatGPTUser } from "../chatgpt-auth";
import DashboardClient from "./DashboardClient";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireChatGPTUser("/dashboard");
  return (
    <DashboardClient
      user={{ name: user.displayName, email: user.email }}
      signOutPath={chatGPTSignOutPath("/")}
    />
  );
}
