import { createContext, useContext, useEffect, useState } from 'react';

interface SimpleUser {
  id: string;
  is_anonymous: boolean;
}

interface AuthContextType {
  user: SimpleUser | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SimpleUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem("userId");
    if (stored) {
      setUser({ id: stored, is_anonymous: true });
    }
    setLoading(false);
  }, []);

  const signIn = async () => {
    const userId = crypto.randomUUID();
    localStorage.setItem("userId", userId);
    setUser({ id: userId, is_anonymous: true });
  };

  const signOut = async () => {
    localStorage.removeItem("userId");
    setUser(null);
  };

  const value = {
    user,
    loading,
    signIn,
    signOut,
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
