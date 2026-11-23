'use client';
import Link from 'next/link';
import Script from 'next/script';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { post } from '@/lib/api';

// Minimal typing for Google Identity Services (loaded from accounts.google.com).
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(o: { client_id: string; callback: (r: { credential: string }) => void }): void;
          renderButton(el: HTMLElement, o: Record<string, unknown>): void;
        };
      };
    };
  }
}

export default function SignIn() {
  const router = useRouter();
  const button = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  const init = () => {
    if (!window.google || !button.current || !clientId) return;
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: ({ credential }) =>
        post('/auth/google', { credential })
          .then(() => router.replace('/me'))
          .catch((e: Error) => setError(e.message)),
    });
    window.google.accounts.id.renderButton(button.current, {
      theme: 'filled_blue',
      size: 'large',
      width: 280,
    });
  };

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-12">
      <h1 className="text-2xl font-bold">Sign in to Force Pulse</h1>
      <Script
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onReady={init}
      />
      {clientId ? (
        <div ref={button} className="min-h-11" />
      ) : (
        <p className="text-red-600">Google sign-in is not configured.</p>
      )}
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      <p className="text-sm text-neutral-600">
        After signing in we&apos;ll ask for your consent to use your data. Phone, emergency contact,
        medical notes and ID documents are visible only to organizers. Read the{' '}
        <Link href="/privacy" className="underline">
          privacy policy
        </Link>
        .
      </p>
    </main>
  );
}
