import Constants from 'expo-constants';

/**
 * Metadata aplikasi (layanan baca-saja).
 * Screen tidak membaca `expo-constants` langsung agar format tampilan tetap terpisah
 * dari sumber data (docs/ARCHITECTURE.md bagian 3).
 */
export type AppInfo = {
  name: string;
  slug: string;
  version: string;
  androidPackage: string | undefined;
  scheme: string | undefined;
  expoSdkVersion: string | undefined;
  easProjectId: string | undefined;
  devServerUrl: string | undefined;
  isDevBuild: boolean;
  buildLabel: string;
};

function readScheme(): string | undefined {
  const scheme = Constants.expoConfig?.scheme;
  if (typeof scheme === 'string' && scheme.length > 0) return scheme;
  if (Array.isArray(scheme) && scheme.length > 0) return scheme[0];
  return undefined;
}

function readEasProjectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined;
  const projectId = extra?.eas?.projectId;
  return typeof projectId === 'string' && projectId.length > 0 ? projectId : undefined;
}

function readDevServerUrl(): string | undefined {
  const hostUri = Constants.expoConfig?.hostUri;
  return typeof hostUri === 'string' && hostUri.length > 0 ? hostUri : undefined;
}

export function getAppInfo(): AppInfo {
  const config = Constants.expoConfig;

  return {
    name: config?.name ?? 'RodaKawan',
    slug: config?.slug ?? 'rodakawan',
    version: config?.version ?? '0.0.0',
    androidPackage: config?.android?.package,
    scheme: readScheme(),
    expoSdkVersion: config?.sdkVersion ?? undefined,
    easProjectId: readEasProjectId(),
    devServerUrl: readDevServerUrl(),
    isDevBuild: __DEV__,
    buildLabel: __DEV__ ? 'Pengembangan (Metro bundler)' : 'Build mandiri (APK/AAB)',
  };
}
