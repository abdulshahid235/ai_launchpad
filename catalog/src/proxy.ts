import { NextResponse } from "next/server";

// [HNI-AUTH-05] This boundary does not read Easy Auth headers and does not grant access.
export function proxy(): NextResponse {
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
