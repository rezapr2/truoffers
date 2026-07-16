'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, setToken } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { User } from '@/lib/types';

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';
const APPLE_CLIENT_ID = process.env.NEXT_PUBLIC_APPLE_CLIENT_ID || '';

declare global {
  interface Window {
    google?: any;
    AppleID?: any;
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

/**
 * Google + Apple sign-in. The buttons only send the provider's ID token to
 * our backend, which verifies it server-side and issues a TruOffers JWT.
 * Configure NEXT_PUBLIC_GOOGLE_CLIENT_ID / NEXT_PUBLIC_APPLE_CLIENT_ID (and
 * the matching backend vars) to activate each provider.
 */
export default function SocialLogin({
  role,
  onSuccess,
}: {
  role?: string;
  onSuccess: (user: User) => void;
}) {
  const { refresh } = useAuth();
  const googleDiv = useRef<HTMLDivElement>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const finish = useCallback(
    async (res: { accessToken: string; user: User }) => {
      setToken(res.accessToken);
      await refresh();
      onSuccess(res.user);
    },
    [refresh, onSuccess],
  );

  // Google Identity Services renders its own (policy-compliant) button
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !googleDiv.current) return;
    let cancelled = false;
    void loadScript('https://accounts.google.com/gsi/client')
      .then(() => {
        if (cancelled || !window.google || !googleDiv.current) return;
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: async (response: { credential: string }) => {
            try {
              const res = await api<{ accessToken: string; user: User }>('/auth/google', {
                method: 'POST',
                body: JSON.stringify({ idToken: response.credential, role }),
              });
              await finish(res);
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Google sign-in failed');
            }
          },
        });
        window.google.accounts.id.renderButton(googleDiv.current, {
          theme: 'outline',
          size: 'large',
          shape: 'pill',
          width: 360,
          text: 'continue_with',
        });
      })
      .catch(() => setError('Could not load Google sign-in'));
    return () => {
      cancelled = true;
    };
  }, [role, finish]);

  async function appleSignIn() {
    if (!APPLE_CLIENT_ID) {
      setNotice('Apple sign-in is not configured yet — set NEXT_PUBLIC_APPLE_CLIENT_ID and APPLE_CLIENT_ID.');
      return;
    }
    setError(null);
    try {
      await loadScript(
        'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js',
      );
      window.AppleID.auth.init({
        clientId: APPLE_CLIENT_ID,
        scope: 'name email',
        redirectURI: `${window.location.origin}/login`,
        usePopup: true,
      });
      const response = await window.AppleID.auth.signIn();
      // Apple only provides the name on the first authorisation
      const nameObj = response?.user?.name;
      const name = nameObj ? `${nameObj.firstName ?? ''} ${nameObj.lastName ?? ''}`.trim() : undefined;
      const res = await api<{ accessToken: string; user: User }>('/auth/apple', {
        method: 'POST',
        body: JSON.stringify({ identityToken: response.authorization.id_token, name, role }),
      });
      await finish(res);
    } catch (err) {
      // User closing the popup raises an error we shouldn't shout about
      const msg = err instanceof Error ? err.message : '';
      if (msg && !msg.includes('popup_closed')) setError(msg || 'Apple sign-in failed');
    }
  }

  function googleNotConfigured() {
    setNotice('Google sign-in is not configured yet — set NEXT_PUBLIC_GOOGLE_CLIENT_ID and GOOGLE_CLIENT_ID.');
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 text-[13px] font-bold text-muted">
        <span className="flex-1 h-px bg-line" />
        or continue with
        <span className="flex-1 h-px bg-line" />
      </div>

      {error && (
        <div className="bg-peach-2/40 border border-primary/30 text-primary-dark text-[13px] font-bold rounded-xl px-4 py-2.5">
          {error}
        </div>
      )}
      {notice && (
        <div className="bg-surface border border-line text-ink-soft text-[13px] font-bold rounded-xl px-4 py-2.5">
          {notice}
        </div>
      )}

      {GOOGLE_CLIENT_ID ? (
        <div ref={googleDiv} className="flex justify-center" />
      ) : (
        <button
          type="button"
          onClick={googleNotConfigured}
          className="flex items-center justify-center gap-3 border border-line bg-card font-bold text-[15px] py-3 rounded-full hover:border-primary transition-colors cursor-pointer"
        >
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"/>
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
            <path fill="#4CAF50" d="M24 44c5.3 0 10.1-2 13.7-5.3l-6.3-5.4C29.3 34.9 26.8 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.6 39.6 16.3 44 24 44z"/>
            <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4 5.6l6.3 5.4C41.4 35.4 44 30.1 44 24c0-1.3-.1-2.6-.4-3.9z"/>
          </svg>
          Continue with Google
        </button>
      )}

      <button
        type="button"
        onClick={appleSignIn}
        className="flex items-center justify-center gap-3 bg-ink text-surface font-bold text-[15px] py-3 rounded-full hover:opacity-90 transition-opacity cursor-pointer"
      >
        <svg width="16" height="19" viewBox="0 0 170 200" fill="currentColor" aria-hidden="true">
          <path d="M150.4 69.2c-.9.7-17.3 9.9-17.3 30.4 0 23.7 20.8 32.1 21.4 32.3-.1.5-3.3 11.4-10.9 22.5-6.8 9.8-13.9 19.5-24.7 19.5s-13.6-6.3-26.1-6.3c-12.2 0-16.5 6.5-26.4 6.5s-16.8-9-24.7-20.1C32.5 141 25 120.5 25 101c0-31.2 20.3-47.8 40.3-47.8 10.6 0 19.5 7 26.2 7 6.3 0 16.2-7.4 28.3-7.4 4.6 0 21 .4 30.6 16.4zM113 39.3c5-5.9 8.5-14.1 8.5-22.3 0-1.1-.1-2.3-.3-3.2-8.1.3-17.7 5.4-23.5 12.1-4.6 5.2-8.9 13.4-8.9 21.7 0 1.2.2 2.5.3 2.9.5.1 1.3.2 2.1.2 7.3 0 16.4-4.9 21.8-11.4z"/>
        </svg>
        Continue with Apple
      </button>
    </div>
  );
}
