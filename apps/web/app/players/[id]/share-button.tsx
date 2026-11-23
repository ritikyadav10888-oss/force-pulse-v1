'use client';
import { useState } from 'react';

/** Native share sheet on phones; copies the link elsewhere. */
export function ShareButton({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);
  async function share() {
    const url = window.location.href;
    if (navigator.share) {
      await navigator.share({ title, url }).catch(() => undefined); // user closed the sheet
    } else {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    }
  }
  return (
    <button type="button" onClick={share} className="self-start text-sm text-blue-700 underline">
      {copied ? 'Link copied' : 'Share profile'}
    </button>
  );
}
