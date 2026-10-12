import { useMemo } from 'react';

import {
  describeBackendStatus,
  readPublicEnv,
  type BackendStatus,
  type PublicEnv,
} from '@/lib/env';
import { getAppInfo, type AppInfo } from '@/services/appInfo';

export type AppStatus = {
  appInfo: AppInfo;
  env: PublicEnv;
  backend: BackendStatus;
};

/**
 * Status aplikasi untuk ditampilkan di UI: identitas build + status konfigurasi backend.
 * Nilainya dihitung sekali per mount karena berasal dari konfigurasi statis.
 */
export function useAppStatus(): AppStatus {
  return useMemo(() => {
    const env = readPublicEnv();
    return {
      env,
      appInfo: getAppInfo(),
      backend: describeBackendStatus(env),
    };
  }, []);
}
