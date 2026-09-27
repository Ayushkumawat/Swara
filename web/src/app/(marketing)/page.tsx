import { currentUser } from "@/lib/server/auth";
import { Landing } from "@/components/marketing/landing";

// Reads the session cookie, so this page is rendered per request.
export const dynamic = "force-dynamic";

export default async function LandingPage() {
  const user = await currentUser();
  return <Landing signedIn={user != null} firstName={user?.name?.trim().split(/\s+/)[0]} />;
}
