import { redirect } from "next/navigation";
import { VideoEditor } from "@/app/admin/VideoEditor";
import { isAdmin } from "@/lib/admin-auth";
import { getSiteVideos } from "@/lib/site-media-db";

export const metadata = { title: "Videos" };

export default async function AdminVideosPage() {
  if (!await isAdmin()) redirect("/admin/login");
  const videos = await getSiteVideos(true);
  return <>
    <header>
      <p className="text-xs font-medium text-[var(--color-accent)]">WEBSITE MEDIA</p>
      <h1 className="font-display mt-2 text-3xl font-bold">Videos</h1>
    </header>
    <VideoEditor videos={videos} />
  </>;
}