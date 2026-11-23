'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, del } from '@/lib/api';

/** Download my data / delete my account. */
export function YourData() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');

  async function download() {
    setError('');
    try {
      const data = await api('/me/data');
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      );
      const a = Object.assign(document.createElement('a'), {
        href: url,
        download: 'force-pulse-my-data.json',
      });
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function remove() {
    setError('');
    try {
      await del('/me/data');
      router.replace('/');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4">
      <h2 className="text-lg font-semibold">Your data</h2>
      <Button type="button" variant="outline" onClick={download}>
        Download my data
      </Button>
      {!confirming ? (
        <Button
          type="button"
          variant="ghost"
          className="text-destructive"
          onClick={() => setConfirming(true)}
        >
          Delete my account
        </Button>
      ) : (
        <div className="flex flex-col gap-2 rounded-md border border-destructive p-3">
          <p className="text-sm">
            This removes your profile, sports, photo and ID documents for good. Past tournament
            entries stay, without your name. Type <strong>DELETE</strong> to confirm.
          </p>
          <Label htmlFor="confirm-delete" className="sr-only">
            Type DELETE to confirm
          </Label>
          <Input
            id="confirm-delete"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
          />
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="flex-1"
              disabled={typed !== 'DELETE'}
              onClick={remove}
            >
              Delete account
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
