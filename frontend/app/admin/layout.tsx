'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { WorkspaceFrame } from '@/components/AppShell';
import AdminSidebar from '@/components/AdminSidebar';
import { Spinner } from '@/components/ui';
import { isStaff, useAuth } from '@/lib/auth-context';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    // While viewing as a business, the admin panel is out of reach until they exit.
    else if (!isStaff(user)) router.replace(user.impersonatedBy ? '/dashboard' : '/');
  }, [loading, user, router, pathname]);

  if (loading || !user || !isStaff(user)) return <Spinner />;
  return <WorkspaceFrame sidebar={(close) => <AdminSidebar onNavigate={close} />}>{children}</WorkspaceFrame>;
}
