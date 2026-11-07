import { chatGPTSignOutPath, requireChatGPTUser } from "../chatgpt-auth";
import AdminClient from "./AdminClient";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await requireChatGPTUser("/admin");
  return (
    <AdminClient
      userEmail={user.email}
      signOutPath={chatGPTSignOutPath("/")}
    />
  );
}
