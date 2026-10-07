'use client';

import { useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    grecaptcha?: { render: (el: HTMLElement, options: { sitekey: string; callback: (token: string) => void; 'expired-callback'?: () => void }) => number; ready: (cb: () => void) => void };
  }
}

export function loadRecaptcha(): Promise<void> {
  if (window.grecaptcha) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://www.google.com/recaptcha/api.js?render=explicit';
    script.async = true;
    script.onload = () => window.grecaptcha?.ready(() => resolve());
    script.onerror = () => reject(new Error('reCAPTCHA failed to load'));
    document.head.appendChild(script);
  });
}

/** The "I'm not a robot" box for guest forms. Renders into `ref` when `siteKey` is set. */
export function useRecaptcha(siteKey: string | undefined, active = true) {
  const ref = useRef<HTMLDivElement>(null);
  const [token, setToken] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!active || !siteKey || !ref.current || ref.current.childElementCount) return;
    const el = ref.current;
    void loadRecaptcha()
      .then(() => window.grecaptcha?.render(el, { sitekey: siteKey, callback: setToken, 'expired-callback': () => setToken(null) }))
      .catch(() => setFailed(true));
  }, [siteKey, active]);
  return { ref, token, failed, required: !!siteKey };
}
