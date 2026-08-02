export function normalizeAppVersion(version: string): string {
  return version.trim().replace(/^v/i, "");
}

export async function resolveAppVersion(
  getRuntimeVersion: () => Promise<string>,
  packagedVersion: string,
): Promise<string> {
  try {
    const runtimeVersion = normalizeAppVersion(await getRuntimeVersion());
    return runtimeVersion || normalizeAppVersion(packagedVersion);
  } catch {
    return normalizeAppVersion(packagedVersion);
  }
}
