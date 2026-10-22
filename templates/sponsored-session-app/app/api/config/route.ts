import { NextResponse } from "next/server";
import { serverRequiredConfig } from "@/lib/env.server";

/**
 * Reports whether server-side configuration is present, as booleans only,
 * never the values. `components/setup-gate.tsx` calls this once on mount to
 * show a readable setup screen instead of a runtime error.
 */
export async function GET() {
  return NextResponse.json(serverRequiredConfig);
}
