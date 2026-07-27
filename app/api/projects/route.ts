import { NextResponse } from "next/server";
import { listProjects } from "@/lib/projects/store";

export async function GET() {
  const projects = await listProjects();
  return NextResponse.json({ projects });
}
