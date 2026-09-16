import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { useAuthStore } from '../../store/useAuthStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FormError } from '@/components/common/FormField';

export function SignupPage() {
  const navigate = useNavigate();
  const { signup, isLoading, error, clearError } = useAuthStore();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    clearError();
    try {
      await signup(email, password, name);
      navigate('/dashboard');
    } catch {
      // Error handled by store
    }
  };

  return (
    <div className="flex flex-col">
      <h2 className="mb-1.5 text-xl font-bold tracking-tight text-foreground">Create an account</h2>
      <p className="mb-6 text-[13px] text-muted-foreground">Get started with multi-tenant inventory management</p>

      {error && (
        <div className="mb-5">
          <FormError error={error} />
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Full Name" htmlFor="signup-name" required>
          <Input
            id="signup-name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="John Doe"
          />
        </Field>

        <Field label="Work Email" htmlFor="signup-email" required>
          <Input
            id="signup-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@company.com"
          />
        </Field>

        <Field label="Password" htmlFor="signup-password" required>
          <Input
            id="signup-password"
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Minimum 6 characters"
          />
        </Field>

        <Button type="submit" disabled={isLoading} className="h-10 w-full">
          {isLoading ? (
            <span>Creating account...</span>
          ) : (
            <>
              <span>Get Started</span>
              <ArrowRight />
            </>
          )}
        </Button>
      </form>

      <p className="mt-6 text-center text-[13px] text-muted-foreground">
        Already have an account?{' '}
        <Link to="/login" className="text-sm font-semibold text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
