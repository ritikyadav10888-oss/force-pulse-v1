import { POLICY_VERSION } from '@force-pulse/shared';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Privacy policy · Force Pulse' };

// shortcut: placeholder wording written by engineering; needs review by the founder (and ideally
// legal) before public launch. Bump POLICY_VERSION in shared when the meaning changes.
export default function Privacy() {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-3 px-4 py-8 text-neutral-800">
      <h1 className="text-2xl font-bold">Privacy policy</h1>
      <p className="text-sm text-neutral-500">Version {POLICY_VERSION}</p>
      <h2 className="font-semibold">What we collect</h2>
      <p>
        Your Google name, email and photo; the profile you enter (name, date of birth, gender, city,
        phone, emergency contact, medical notes, guardian details if under 18); your sport details;
        ID documents you upload; and your tournament registrations.
      </p>
      <h2 className="font-semibold">Who sees it</h2>
      <p>
        Public: your name, photo, city, sports and roles, bio and social links, and an age group
        (never your date of birth). Organizers of tournaments you enter: everything, including
        phone, emergency contact, medical notes and ID documents. Every view of an ID document is
        logged.
      </p>
      <h2 className="font-semibold">Photos on streams</h2>
      <p>Only if you opt in. You can withdraw at any time.</p>
      <h2 className="font-semibold">Your rights</h2>
      <p>
        You can download all your data or delete your account from your profile. Deleting removes
        your personal details; tournament results may be kept without your name.
      </p>
      <p>
        We never sell your data. We never store full Aadhaar numbers; upload a masked copy only.
      </p>
    </main>
  );
}
