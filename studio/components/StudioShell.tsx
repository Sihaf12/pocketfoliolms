'use client';
import { usePathname } from 'next/navigation';
import { Shell } from './Shell';
import { WorkspaceProvider } from './Workspace';

const STUDIO_PUBLIC = ['/studio/sign-in', '/studio/invite'];
const CONSOLE_PUBLIC = ['/sign-in', '/invite'];

export function StudioShell({ academy, children }: { academy: string; children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  const bare = STUDIO_PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  return (
    <WorkspaceProvider kind="studio" place={academy} publicPaths={STUDIO_PUBLIC}>
      <Shell bare={bare}>{children}</Shell>
    </WorkspaceProvider>
  );
}

export function ConsoleShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  const bare = CONSOLE_PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  return (
    <WorkspaceProvider kind="console" place="Trader Academy" publicPaths={CONSOLE_PUBLIC}>
      <Shell bare={bare}>{children}</Shell>
    </WorkspaceProvider>
  );
}
