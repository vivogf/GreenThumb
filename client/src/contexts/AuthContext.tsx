import { createContext, useContext, useEffect, useState } from 'react';

interface AuthUser {
  id: number;
  name: string | null;
  notification_time?: string;
  recovery_key: string;
  created_at: string;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  createAnonymousAccount: (name?: string) => Promise<AuthUser>;
  signInWithRecoveryKey: (recoveryKey: string) => Promise<void>;
  signOut: () => Promise<void>;
  updateUser: (userData: Partial<AuthUser>) => void;
  regenerateRecoveryKey: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkSession = async () => {
      try {
        const response = await fetch('/api/auth/me', {
          credentials: 'include',
        });

        if (response.ok) {
          const data = await response.json();
          setUser(data.user);
        }
      } catch (error) {
        console.error('Session check failed:', error);
      } finally {
        setLoading(false);
      }
    };

    checkSession();
  }, []);

  const createAnonymousAccount = async (name?: string): Promise<AuthUser> => {
    const response = await fetch('/api/auth/create-anonymous', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
      credentials: 'include',
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to create account');
    }

    setUser(data.user);
    return data.user;
  };

  const signInWithRecoveryKey = async (recoveryKey: string) => {
    const response = await fetch('/api/auth/login-recovery', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recoveryKey }),
      credentials: 'include',
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Invalid recovery key');
    }

    setUser(data.user);
  };

  const signOut = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch (error) {
      console.error('Logout error:', error);
    }
    setUser(null);
  };

  const updateUser = (userData: Partial<AuthUser>) => {
    setUser((prevUser) => prevUser ? { ...prevUser, ...userData } : null);
  };

  const regenerateRecoveryKey = async () => {
    const response = await fetch('/api/auth/regenerate-recovery-key', {
      method: 'POST',
      credentials: 'include',
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to regenerate recovery key');
    }

    setUser(data.user);
  };

  const value = {
    user,
    loading,
    createAnonymousAccount,
    signInWithRecoveryKey,
    signOut,
    updateUser,
    regenerateRecoveryKey,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
