import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
export async function GET(req: NextRequest) { return NextResponse.json({ user: await currentUser(req) }); }
