"use client";

import DashboardPage from "@/app/dashboard/page";
import { EmbeddedWorkspace } from "@/app/dashboard/WorkspaceContext";

export function ModelWorkspace() {
  return <EmbeddedWorkspace value={true}><DashboardPage /></EmbeddedWorkspace>;
}