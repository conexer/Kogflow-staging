'use client';

import { useState } from 'react';
import { X, Sparkles, FolderPlus } from 'lucide-react';
import { createProject } from '@/app/actions/projects';
import { useRouter } from 'next/navigation';

interface CreateProjectModalProps {
    isOpen: boolean;
    onClose: () => void;
    userId: string;
    onProjectCreated?: (project: any) => void;
    isFirstProject?: boolean;
}

export function CreateProjectModal({
    isOpen,
    onClose,
    userId,
    onProjectCreated,
    isFirstProject = false
}: CreateProjectModalProps) {
    const router = useRouter();
    const [name, setName] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState('');

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!name.trim()) return;

        setIsSubmitting(true);
        setError('');

        try {
            // Handle Guest Mode
            if (userId === 'guest' || userId.startsWith('guest')) {
                const newProject = {
                    id: `guest-${Date.now()}`, // Consistent ID format
                    name: name,
                    created_at: new Date().toISOString()
                };

                // Save to LocalStorage
                const saved = localStorage.getItem('guest_projects');
                const projects = saved ? JSON.parse(saved) : [];
                const updated = [...projects, newProject];
                localStorage.setItem('guest_projects', JSON.stringify(updated));

                // Trigger Success
                if (onProjectCreated) {
                    onProjectCreated(newProject);
                }
                onClose();
                return;
            }

            // Handle Authenticated User
            const result = await createProject(userId, name);

            if (result.success && result.project) {
                if (onProjectCreated) {
                    onProjectCreated(result.project);
                }
                router.refresh();
                onClose();
            } else {
                setError(result.error || 'Failed to create project');
            }
        } catch (err: any) {
            setError(err.message || 'Something went wrong');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-background w-full max-w-md rounded-2xl shadow-2xl border border-border p-6 space-y-6 relative animate-in zoom-in-95 duration-200">
                {!isFirstProject && (
                    <button
                        onClick={onClose}
                        className="absolute top-4 right-4 p-2 hover:bg-muted rounded-full transition-colors"
                    >
                        <X className="w-4 h-4 text-muted-foreground" />
                    </button>
                )}

                <div className="text-center space-y-2">
                    <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                        <FolderPlus className="w-6 h-6 text-primary" />
                    </div>
                    <h2 className="text-2xl font-bold tracking-tight">
                        {isFirstProject ? 'Welcome to Kogflow!' : 'New Project'}
                    </h2>
                    <p className="text-muted-foreground">
                        {isFirstProject
                            ? "Let's get started by creating your first project space."
                            : "Create a new space for your staging designs."}
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <label htmlFor="projectName" className="text-sm font-medium">Project Name</label>
                        <input
                            id="projectName"
                            type="text"
                            placeholder="e.g. 123 Main St"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="w-full px-4 py-2 bg-background border border-border rounded-xl focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                            autoFocus
                        />
                        {error && <p className="text-xs text-destructive font-medium">{error}</p>}
                    </div>

                    <div className="flex flex-col gap-3 pt-2">
                        <button
                            type="submit"
                            disabled={!name.trim() || isSubmitting}
                            className="w-full py-3 bg-primary text-primary-foreground font-bold rounded-xl shadow-lg hover:shadow-xl hover:bg-primary/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {isSubmitting ? (
                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                                <Sparkles className="w-4 h-4" />
                            )}
                            {isFirstProject ? 'Start Creating' : 'Create Project'}
                        </button>

                        {!isFirstProject && (
                            <button
                                type="button"
                                onClick={onClose}
                                disabled={isSubmitting}
                                className="w-full py-2.5 bg-muted/50 text-foreground font-medium rounded-xl hover:bg-muted transition-all"
                            >
                                Cancel
                            </button>
                        )}
                    </div>
                </form>
            </div>
        </div>
    );
}
