import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { useAuthStore } from '../../store/useAuthStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Field, FormError } from '@/components/common/FormField';

export function LoginPage() {
  const navigate = useNavigate();
  const { login, isLoading, error, clearError } = useAuthStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    clearError();
    try {
      await login(email, password);
      navigate('/dashboard');
    } catch {
      // Error handled by store
    }
  };

  return (
    <div className="flex flex-col">
      <h2 className="mb-1.5 text-xl font-bold tracking-tight text-foreground">Welcome back</h2>
      <p className="mb-6 text-[13px] text-muted-foreground">Sign in to your account to access your workspace</p>

      {error && (
        <div className="mb-5">
          <FormError error={error} />
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Email Address" htmlFor="login-email" required>
          <Input
            id="login-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@company.com"
          />
        </Field>

        <Field htmlFor="login-password">
          <div className="flex items-center justify-between">
            <Label htmlFor="login-password">
              Password<span className="ml-0.5 text-destructive" aria-hidden>*</span>
            </Label>
            <a href="#" className="text-xs font-medium text-primary hover:underline">
              Forgot password?
            </a>
          </div>
          <Input
            id="login-password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </Field>

        <Button type="submit" disabled={isLoading} className="h-10 w-full">
          {isLoading ? (
            <span>Signing in...</span>
          ) : (
            <>
              <span>Sign In</span>
              <ArrowRight />
            </>
          )}
        </Button>
      </form>

      <p className="mt-6 text-center text-[13px] text-muted-foreground">
        Don&apos;t have an account?{' '}
        <Link to="/signup" className="text-sm font-semibold text-primary hover:underline">
          Create account
        </Link>
      </p>
    </div>
  );
}
