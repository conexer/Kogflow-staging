'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import {
    Sparkles,
    Search,
    Plus,
    Book,
    HelpCircle,
    CreditCard,
    User,
    LogOut,
    Menu,
    X,
    Settings,
    Check,
    Trash2
} from 'lucide-react';
import { createProject, getProjects, renameProject, deleteProject } from '@/app/actions/projects';
import { useEffect } from 'react';


export function DashboardSidebar() {
    const { user, signOut } = useAuth();
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    // State for projects
    const [projects, setProjects] = useState<any[]>([]);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [isLoading, setIsLoading] = useState(true);

    // Initial load
    useEffect(() => {
        if (user) {
            getProjects(user.id).then(res => {
                if (res.projects) {
                    setProjects(res.projects.map((p: any) => ({
                        ...p,
                        active: false, // Default inactive
                        date: new Date(p.created_at).toLocaleDateString()
                    })));
                    // Set first active if exists
                    if (res.projects.length > 0) {
                        // Logic to set active... 
                    }
                }
                setIsLoading(false);
            });
        } else {
            // Load guest projects
            const saved = localStorage.getItem('guest_projects');
            if (saved) {
                setProjects(JSON.parse(saved));
            }
            setIsLoading(false);
        }
    }, [user]);

    const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

    const handleDeleteProject = async (e: React.MouseEvent, projectId: string) => {
        e.stopPropagation();
        if (pendingDeleteId === projectId) {
            // Confirm Delete
            if (user) {
                await deleteProject(projectId);
            }

            setProjects(prev => {
                const updated = prev.filter(p => p.id !== projectId);
                if (!user) {
                    localStorage.setItem('guest_projects', JSON.stringify(updated));
                }
                return updated;
            });
            setPendingDeleteId(null);
        } else {
            // Start Delete Flow
            setPendingDeleteId(projectId);
            setTimeout(() => setPendingDeleteId(null), 3000);
        }
    };

    const handleCreateProject = async () => {
        const newName = `Project ${projects.length + 1}`;

        if (user) {
            // Authenticated: Save to DB
            const res = await createProject(user.id, newName);
            if (res.success && res.project) {
                const newProject = {
                    ...res.project,
                    date: new Date(res.project.created_at).toLocaleDateString(),
                    active: true
                };
                setProjects(prev => {
                    const updated = [...prev.map(p => ({ ...p, active: false })), newProject];
                    return updated;
                });
            }
        } else {
            // Guest: Save to LocalStorage
            const newProject = {
                id: `guest-${Date.now()}`,
                name: newName,
                date: new Date().toLocaleDateString(),
                active: true,
                created_at: new Date().toISOString() // match structure roughly
            };
            setProjects(prev => {
                const updated = [...prev.map(p => ({ ...p, active: false })), newProject];
                localStorage.setItem('guest_projects', JSON.stringify(updated));
                return updated;
            });
        }
    };

    const startEditing = (e: React.MouseEvent, project: any) => {
        e.stopPropagation();
        setEditingId(project.id);
        setEditName(project.name);
    };

    const saveEditing = async (e?: React.MouseEvent | React.FormEvent) => {
        e?.stopPropagation();
        if (editingId && editName.trim()) {
            if (user) {
                await renameProject(editingId, editName);
            }
            // Update state (and local storage if guest)
            setProjects(prev => {
                const updated = prev.map(p => p.id === editingId ? { ...p, name: editName } : p);
                if (!user) {
                    localStorage.setItem('guest_projects', JSON.stringify(updated));
                }
                return updated;
            });
            setEditingId(null);
            setEditName('');
        }
    };

    const cancelEditing = (e: React.MouseEvent) => {
        e.stopPropagation();
        setEditingId(null);
        setEditName('');
    };

    const SidebarContent = () => (
        <div className="flex flex-col h-full bg-card border-r border-border/40">
            {/* Logo */}
            <div className="p-4 border-b border-border/40 flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
                    <Sparkles className="w-5 h-5 text-white" />
                </div>
                <span className="font-bold text-xl tracking-tighter">Kogflow</span>
            </div>

            {/* Search and Create */}
            <div className="p-4 space-y-3">
                <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <input
                        type="text"
                        placeholder="Search projects..."
                        className="w-full bg-muted/50 border border-border/50 rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                </div>
                <button
                    onClick={handleCreateProject}
                    className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium py-2 rounded-lg flex items-center justify-center gap-2 transition-colors shadow-sm"
                >
                    <Plus className="w-4 h-4" />
                    Create Project
                </button>
            </div>

            {/* Projects List */}
            <div className="flex-1 overflow-y-auto px-2 py-2">
                <div className="space-y-1">
                    {projects.map((project) => (
                        <div
                            key={project.id}
                            className={cn(
                                "p-3 rounded-lg cursor-pointer transition-colors group relative",
                                project.active
                                    ? "bg-muted border border-border/50"
                                    : "hover:bg-muted/50"
                            )}
                            onClick={() => {
                                if (editingId === null) {
                                    setProjects(projects.map(p => ({ ...p, active: p.id === project.id })));
                                }
                            }}
                        >
                            {editingId === project.id ? (
                                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                    <input
                                        autoFocus
                                        value={editName}
                                        onChange={(e) => setEditName(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') saveEditing();
                                            if (e.key === 'Escape') setEditingId(null);
                                        }}
                                        className="flex-1 bg-background border border-primary rounded px-2 py-1 text-sm h-8"
                                    />
                                    <button onClick={saveEditing} className="p-1 hover:text-green-500"><Check className="w-4 h-4" /></button>
                                    <button onClick={cancelEditing} className="p-1 hover:text-red-500"><X className="w-4 h-4" /></button>
                                </div>
                            ) : (
                                <div className="flex justify-between items-start w-full">
                                    <div className="min-w-0 flex-1">
                                        <div className="font-medium text-sm flex items-center gap-2">
                                            <Sparkles className="w-3 h-3 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0" />
                                            <span className="truncate block">{project.name}</span>
                                        </div>
                                        <div className="text-xs text-muted-foreground pl-5">{project.date}</div>
                                    </div>

                                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-2">
                                        <button
                                            onClick={(e) => startEditing(e, project)}
                                            className="p-1.5 hover:bg-background rounded-md text-muted-foreground hover:text-primary transition-all"
                                        >
                                            <Settings className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                            onClick={(e) => handleDeleteProject(e, project.id)}
                                            className={cn(
                                                "p-1.5 rounded-md transition-all flex items-center gap-1",
                                                pendingDeleteId === project.id
                                                    ? "bg-destructive text-destructive-foreground px-2"
                                                    : "hover:bg-destructive hover:text-destructive-foreground text-muted-foreground"
                                            )}
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                            {pendingDeleteId === project.id && <span className="text-[10px] font-bold">Confirm</span>}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {/* Bottom Menu */}
            <div className="p-4 border-t border-border/40 space-y-1">
                <Link href="#" className="flex items-center gap-3 px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-lg transition-colors">
                    <Book className="w-4 h-4" />
                    Resources
                </Link>
                <Link href="#" className="flex items-center gap-3 px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-lg transition-colors">
                    <HelpCircle className="w-4 h-4" />
                    Help Center
                </Link>
                <Link href="/pricing" className="flex items-center gap-3 px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-lg transition-colors">
                    <CreditCard className="w-4 h-4" />
                    Manage Plan
                </Link>
            </div>

            {/* User Profile */}
            <div className="p-4 border-t border-border/40">
                <div className="flex items-center gap-3 pl-1">
                    <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center overflow-hidden border border-border">
                        <User className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{user?.email || 'User'}</p>
                        <button onClick={() => signOut()} className="text-xs text-muted-foreground hover:text-destructive transition-colors">
                            Sign out
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );

    return (
        <>
            {/* Desktop Sidebar */}
            <div className="hidden md:block w-72 fixed inset-y-0 z-30">
                <SidebarContent />
            </div>

            {/* Mobile Header */}
            <div className="md:hidden flex items-center justify-between p-4 border-b border-border/40 bg-background/80 backdrop-blur-md sticky top-0 z-30">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
                        <Sparkles className="w-5 h-5 text-white" />
                    </div>
                    <span className="font-bold text-xl tracking-tighter">Kogflow</span>
                </div>
                <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
                    {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
                </button>
            </div>

            {/* Mobile Overlay Menu */}
            {isMobileMenuOpen && (
                <div className="md:hidden fixed inset-0 z-20 pt-16 bg-background/95 backdrop-blur-sm">
                    <div className="h-full pt-4">
                        <SidebarContent />
                    </div>
                </div>
            )}
        </>
    );
}
