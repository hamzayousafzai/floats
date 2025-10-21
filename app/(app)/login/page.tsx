import { Suspense } from 'react';
import LoginForm from '@/components/auth/LoginForm';

// A simple loading component to show while the main component loads on the client
function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <span className="loading loading-spinner loading-lg"></span>
    </div>
  );
}

export default function LoginPage() {
  return (
    // Suspense tells Next.js to show the 'fallback' UI on the server,
    // and then render the LoginForm on the client.
    <Suspense fallback={<Loading />}>
      <LoginForm />
    </Suspense>
  );
}