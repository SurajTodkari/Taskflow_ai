import { LogoMark } from '../../components/brand/Logo';
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { CheckSquare, Eye, EyeOff, Loader2, Sparkles, KanbanSquare, CalendarCheck, AlertCircle } from 'lucide-react';
import { useAuth } from '../../lib/auth';

const loginSchema = z.object({ name: z.string().optional(), email: z.string().regex(/^\S+@\S+\.\S+$/, 'Enter a valid email address'), password: z.string().min(1, 'Password is required') });
const regSchema = z.object({ name: z.string().trim().min(1, 'Name is required'), email: z.string().regex(/^\S+@\S+\.\S+$/, 'Enter a valid email address'), password: z.string().min(8, 'Password must be at least 8 characters') });
type V = { name?: string; email: string; password: string };

const FEATURES = [[Sparkles, 'AI assistant that plans your day'], [KanbanSquare, 'Projects, milestones and Kanban boards'], [CalendarCheck, 'Smart reminders and daily reports']] as const;

export default function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const { login, register: signUp } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const isReg = mode === 'register';
  const [error, setError] = useState('');
  const [show, setShow] = useState(false);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<V>({ resolver: zodResolver(isReg ? regSchema : loginSchema) });
  const submit = handleSubmit(async (v) => {
    setError('');
    try {
      if (isReg) await signUp({ email: v.email, password: v.password, name: (v.name ?? '').trim() }); else await login(v.email, v.password);
      nav((loc.state as { from?: string } | null)?.from || '/', { replace: true });
    } catch (err) { setError(err instanceof Error ? err.message : 'Something went wrong'); }
  });
  const err = (m?: string) => (m ? <p className="mt-1 text-xs text-danger">{m}</p> : null);
  return (
    <div className="grid min-h-screen bg-bg lg:grid-cols-2">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 p-12 text-white lg:flex">
        <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-white/10 blur-3xl" /><div className="pointer-events-none absolute -bottom-32 -left-20 h-96 w-96 rounded-full bg-brand-400/20 blur-3xl" />
        <div className="relative flex items-center gap-2 text-lg font-semibold"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white"><LogoMark size={30} /></span>TaskFlow AI <span className="text-xs font-medium tracking-widest text-sky-200">BY NEXORA</span></div>
        <div className="relative space-y-6"><h2 className="max-w-md text-4xl font-semibold leading-tight">Plan less. Finish more.</h2>
          <ul className="space-y-3 text-sm text-white/85">{FEATURES.map(([Icon, t]) => <li key={t} className="flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10"><Icon size={16} /></span>{t}</li>)}</ul></div>
        <p className="relative text-xs text-white/60">Your tasks, projects and schedule in one calm workspace.</p>
      </aside>
      <main className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 text-lg font-semibold lg:hidden"><LogoMark size={34} />TaskFlow AI</div>
          <h1 className="text-page font-semibold">{isReg ? 'Create your account' : 'Welcome back'}</h1>
          <p className="mb-6 mt-1 text-sm text-fg-muted">{isReg ? 'Start organizing your work in minutes.' : 'Sign in to continue to your workspace.'}</p>
          <form onSubmit={submit} noValidate className="space-y-4">
            {error && <div role="alert" className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger"><AlertCircle size={16} className="mt-0.5 shrink-0" />{error}</div>}
            {isReg && <div><label className="label" htmlFor="a-name">Name</label><input id="a-name" className="input" autoComplete="name" aria-invalid={!!errors.name} {...register('name')} />{err(errors.name?.message)}</div>}
            <div><label className="label" htmlFor="a-email">Email</label><input id="a-email" type="email" className="input" autoComplete="email" aria-invalid={!!errors.email} {...register('email')} />{err(errors.email?.message)}</div>
            <div><label className="label" htmlFor="a-pw">Password</label>
              <div className="relative"><input id="a-pw" type={show ? 'text' : 'password'} className="input pr-10" autoComplete={isReg ? 'new-password' : 'current-password'} aria-invalid={!!errors.password} {...register('password')} />
                <button type="button" className="icon-btn absolute right-1 top-1/2 -translate-y-1/2" aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show} onClick={() => setShow((s) => !s)}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button></div>
              {err(errors.password?.message)}</div>
            <button className="btn-primary w-full !py-2.5" disabled={isSubmitting}>{isSubmitting ? <><Loader2 size={16} className="animate-spin" />Please wait...</> : isReg ? 'Create account' : 'Sign in'}</button>
          </form>
          <p className="mt-6 text-center text-sm text-fg-muted">{isReg ? 'Already have an account? ' : 'New here? '}
            <Link className="font-medium text-accent hover:underline" to={isReg ? '/login' : '/register'}>{isReg ? 'Sign in' : 'Create an account'}</Link></p>
        </div>
      </main>
    </div>
  );
}
