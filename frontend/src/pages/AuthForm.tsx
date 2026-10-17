import AuthPage from '../features/auth/AuthPage';
export default function AuthForm({ mode }: { mode: 'login' | 'register' }) { return <AuthPage mode={mode} />; }
