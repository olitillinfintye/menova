import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin-auth";
import { ModelWorkspace } from "@/app/admin/ModelWorkspace";

export default async function AdminModelsPage() {
  if (!await isAdmin()) redirect("/admin/login");
  return <ModelWorkspace />;
}