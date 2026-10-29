import { createContext, useContext, useEffect, useState } from 'react';

interface AuthUser {
  id: number;
  name: string | null;
  notification_time?: string;
  timezone?: string | null;
  season_mode?: string;
  created_at: string;
}

// The server sends recovery_key only in the create and regenerate answers. The caller shows it once;
// it is never kept in the user state.
function withoutKey(user: AuthUser & { recovery_key?: string }): AuthUser {
  const { recovery_key: _key, ...rest } = user;
  return rest;
}

/** confirm-recovery-key outcome; not_pending = the shown key is not active, the old key still works. */
export type ConfirmKeyResult = 'committed' | 'already_current' | 'not_pending';

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  /** Resolves to the new recovery key, to show once. */
  createAnonymousAccount: (name?: string) => Promise<string>;
  signInWithRecoveryKey: (recoveryKey: string) => Promise<void>;
  signOut: () => Promise<void>;
  updateUser: (userData: Partial<AuthUser>) => void;
  /** Resolves to the new pending key, to show until confirmed. The current key still works until then. */
  regenerateRecoveryKey: () => Promise<string>;
  /** Promotes the pending key. A 401 (session gone) signs out locally and throws. */
  confirmRecoveryKey: (recoveryKey: string) => Promise<ConfirmKeyResult>;
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
          setUser(withoutKey(data.user));
        }
      } catch (error) {
        console.error('Session check failed:', error);
      } finally {
        setLoading(false);
      }
    };

    checkSession();
  }, []);

  const createAnonymousAccount = async (name?: string): Promise<string> => {
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

    setUser(withoutKey(data.user));
    return data.user.recovery_key;
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

    setUser(withoutKey(data.user));
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

  const regenerateRecoveryKey = async (): Promise<string> => {
    const response = await fetch('/api/auth/regenerate-recovery-key', {
      method: 'POST',
      credentials: 'include',
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to regenerate recovery key');
    }

    if (typeof data.pending_recovery_key !== 'string') {
      throw new Error('Failed to regenerate recovery key');
    }
    setUser(withoutKey(data.user));
    return data.pending_recovery_key;
  };

  const confirmRecoveryKey = async (recoveryKey: string): Promise<ConfirmKeyResult> => {
    const response = await fetch('/api/auth/confirm-recovery-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recoveryKey }),
      credentials: 'include',
    });

    if (response.status === 409) return 'not_pending';
    if (response.status === 401) {
      // This session was revoked (another device signed in with the new key): back to the login screen.
      setUser(null);
      throw new Error('Not authenticated');
    }

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to confirm recovery key');
    }

    setUser(withoutKey(data.user));
    return data.status;
  };

  const value = {
    user,
    loading,
    createAnonymousAccount,
    signInWithRecoveryKey,
    signOut,
    updateUser,
    regenerateRecoveryKey,
    confirmRecoveryKey,
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
