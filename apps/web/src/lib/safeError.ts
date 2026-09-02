/** The only browser error detail allowed in default logs or local operational diagnostics. */
export function safeBrowserErrorFields(error: unknown): { errorName: string } {
  const candidate = error instanceof Error ? error.name : "UnknownError";
  return {
    errorName: /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(candidate) ? candidate : "Error"
  };
}
