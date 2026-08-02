import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import packageMetadata from "../../package.json";
import { normalizeAppVersion, resolveAppVersion } from "@/lib/app-version";

export const PACKAGED_APP_VERSION = normalizeAppVersion(packageMetadata.version);

export function useAppVersion(): string {
  const [version, setVersion] = useState(PACKAGED_APP_VERSION);

  useEffect(() => {
    let active = true;

    void resolveAppVersion(getVersion, PACKAGED_APP_VERSION).then((resolvedVersion) => {
      if (active) setVersion(resolvedVersion);
    });

    return () => {
      active = false;
    };
  }, []);

  return version;
}
