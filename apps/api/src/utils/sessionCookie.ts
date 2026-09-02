/** One cookie policy for login, registration, guest bootstrapping and logout. A production
 * session must never cross an unencrypted connection; local development remains usable over
 * Vite's HTTP proxy. */
export function sessionCookieOptions(expires?: Date, nodeEnv = process.env.NODE_ENV) {
  return {
    path: "/" as const,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: nodeEnv === "production",
    ...(expires ? { expires } : {})
  };
}
