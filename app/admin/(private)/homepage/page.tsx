import { redirect } from "next/navigation";
import { HomepageEditor } from "@/app/admin/HomepageEditor";
import { isAdmin } from "@/lib/admin-auth";
import { getHomeContent } from "@/lib/site-content-db";

export const metadata = { title: "Homepage" };

export default async function AdminHomepagePage() {
  if (!await isAdmin()) redirect("/admin/login");
  const initialState = await getHomeContent(true);
  return <>
    <header>
      <p className="text-xs font-medium text-[var(--color-accent)]">WEBSITE CONTENT</p>
      <h1 className="font-display mt-2 text-3xl font-bold">Homepage</h1>
    </header>
    <HomepageEditor initialState={initialState} />
  </>;
}