'use client';
import type { MeResponse } from '@force-pulse/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';

/** Loads the signed-in user; sends anonymous visitors to /signin and unconsented ones to /consent. */
export function useMe() {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const reload = useCallback(
    () =>
      api<MeResponse>('/me')
        .then((m) => {
          if (m.consent.required) router.replace('/consent');
          else setMe(m);
        })
        .catch((e) => {
          if (e instanceof ApiError && e.status === 401) router.replace('/signin');
          else throw e;
        }),
    [router],
  );
  useEffect(() => {
    void reload();
  }, [reload]);
  return { me, reload };
}
