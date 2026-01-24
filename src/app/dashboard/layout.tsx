import { DashboardSidebar } from '@/components/dashboard-sidebar';

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <div className="min-h-screen bg-background text-foreground flex flex-col md:flex-row">
            <DashboardSidebar />
            <main className="flex-1 md:ml-72 min-h-screen">
                {children}
            </main>
        </div>
    );
}
