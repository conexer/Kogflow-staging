'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import Link from 'next/link';
import { Sparkles, Mail, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';

export default function ForgotPasswordPage() {
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [sent, setSent] = useState(false);
    const { resetPassword } = useAuth();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        const { error } = await resetPassword(email);

        if (error) {
            toast.error(error.message || 'Failed to send reset email');
            setLoading(false);
        } else {
            toast.success('Password reset email sent!');
            setSent(true);
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center px-4 bg-background">
            <div className="w-full max-w-md space-y-8">
                {/* Logo */}
                <div className="text-center">
                    <Link href="/" className="inline-flex items-center gap-2 font-bold text-2xl tracking-tighter">
                        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
                            <Sparkles className="w-6 h-6 text-white" />
                        </div>
                        <span>Kogflow</span>
                    </Link>
                    <h1 className="mt-6 text-3xl font-bold">Reset your password</h1>
                    <p className="mt-2 text-muted-foreground">
                        {sent
                            ? 'Check your email for a password reset link'
                            : 'Enter your email and we\'ll send you a reset link'}
                    </p>
                </div>

                {!sent ? (
                    <form onSubmit={handleSubmit} className="mt-8 space-y-6">
                        <div>
                            <label htmlFor="email" className="block text-sm font-medium mb-2">
                                Email address
                            </label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                                <input
                                    id="email"
                                    type="email"
                                    required
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="w-full pl-10 pr-4 py-3 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                                    placeholder="you@example.com"
                                />
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full py-3 px-4 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {loading ? 'Sending...' : 'Send reset link'}
                        </button>

                        <Link
                            href="/login"
                            className="flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                        >
                            <ArrowLeft className="w-4 h-4" />
                            Back to sign in
                        </Link>
                    </form>
                ) : (
                    <div className="mt-8 space-y-6 text-center">
                        <div className="p-4 bg-muted rounded-lg">
                            <p className="text-sm">
                                We sent a password reset link to{' '}
                                <span className="font-medium">{email}</span>
                            </p>
                            <p className="text-xs text-muted-foreground mt-2">
                                Didn't receive it? Check your spam folder or try again.
                            </p>
                        </div>

                        <div className="flex flex-col gap-2">
                            <button
                                onClick={() => {
                                    setSent(false);
                                    setEmail('');
                                }}
                                className="text-sm text-primary hover:underline"
                            >
                                Try different email
                            </button>

                            <Link
                                href="/login"
                                className="flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                            >
                                <ArrowLeft className="w-4 h-4" />
                                Back to sign in
                            </Link>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
