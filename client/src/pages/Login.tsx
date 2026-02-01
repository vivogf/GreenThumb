import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Leaf, Key, User, Copy, Check, AlertTriangle, ArrowLeft } from 'lucide-react';

type LoginMode = 'choose' | 'create' | 'login' | 'show-key';

export default function Login() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<LoginMode>('choose');
  const [name, setName] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [newUserKey, setNewUserKey] = useState('');
  const [copied, setCopied] = useState(false);
  const { user, createAnonymousAccount, signInWithRecoveryKey } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  useEffect(() => {
    if (user && mode !== 'show-key') {
      setLocation('/');
    }
  }, [user, mode, setLocation]);

  const handleCreateAccount = async () => {
    setLoading(true);
    try {
      const newUser = await createAnonymousAccount(name || undefined);
      setNewUserKey(newUser.recovery_key);
      setMode('show-key');
    } catch (error: any) {
      toast({
        title: t('common.error'),
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await signInWithRecoveryKey(recoveryKey);
      toast({
        title: t('common.welcomeBack'),
        description: t('common.signedIn'),
      });
    } catch (error: any) {
      toast({
        title: t('common.error'),
        description: error.message,
        variant: 'destructive',
      });
      setLoading(false);
    }
  };

  const copyKey = async () => {
    await navigator.clipboard.writeText(newUserKey);
    setCopied(true);
    toast({
      title: t('profile.copied'),
      description: t('profile.copiedHint'),
    });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleContinue = () => {
    setLocation('/');
  };

  // Choose mode - initial screen
  if (mode === 'choose') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center space-y-3">
            <div className="flex justify-center">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                <Leaf className="w-8 h-8 text-primary" />
              </div>
            </div>
            <CardTitle className="text-3xl font-medium">{t('login.title')}</CardTitle>
            <CardDescription>
              {t('login.subtitle')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              onClick={() => setMode('create')}
              className="w-full"
              size="lg"
            >
              <User className="w-4 h-4 mr-2" />
              {t('login.createAccount')}
            </Button>
            <Button
              onClick={() => setMode('login')}
              variant="outline"
              className="w-full"
              size="lg"
            >
              <Key className="w-4 h-4 mr-2" />
              {t('login.haveKey')}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Create account mode
  if (mode === 'create') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center space-y-3">
            <button
              onClick={() => setMode('choose')}
              className="absolute top-4 left-4 p-2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex justify-center">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                <Leaf className="w-8 h-8 text-primary" />
              </div>
            </div>
            <CardTitle className="text-2xl font-medium">{t('login.createTitle')}</CardTitle>
            <CardDescription>
              {t('login.createSubtitle')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">{t('login.nameLabel')}</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="name"
                  type="text"
                  placeholder={t('login.namePlaceholder')}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
              <div className="flex gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-amber-500 mb-1">{t('login.importantTitle')}</p>
                  <p className="text-muted-foreground">
                    {t('login.importantText')}
                    <strong className="text-foreground"> {t('login.importantSaveIt')}</strong>
                    {t('login.importantNoRestore')}
                  </p>
                </div>
              </div>
            </div>

            <Button
              onClick={handleCreateAccount}
              className="w-full"
              size="lg"
              disabled={loading}
            >
              {loading ? t('login.creating') : t('login.create')}
            </Button>

            <button
              onClick={() => setMode('choose')}
              className="text-sm text-muted-foreground hover:text-primary transition-colors block w-full text-center"
            >
              {t('login.back')}
            </button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show key after account creation
  if (mode === 'show-key') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center space-y-3">
            <div className="flex justify-center">
              <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center">
                <Check className="w-8 h-8 text-green-500" />
              </div>
            </div>
            <CardTitle className="text-2xl font-medium">{t('login.accountCreated')}</CardTitle>
            <CardDescription>
              {t('login.saveKeyNow')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
              <div className="flex gap-3">
                <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-destructive mb-1">{t('login.saveKeyWarningTitle')}</p>
                  <p className="text-muted-foreground">
                    {t('login.saveKeyWarningText')} <strong className="text-foreground">{t('login.saveKeyWarningOnly')}</strong> {t('login.saveKeyWarningAccess')} <strong className="text-foreground">{t('login.saveKeyWarningLost')}</strong>.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t('login.yourRecoveryKey')}</Label>
              <div className="flex gap-2">
                <code className="flex-1 p-3 bg-muted rounded-lg font-mono text-sm break-all select-all">
                  {newUserKey}
                </code>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={copyKey}
                  className="flex-shrink-0"
                >
                  {copied ? (
                    <Check className="w-4 h-4 text-green-500" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </div>

            <Button
              onClick={handleContinue}
              className="w-full"
              size="lg"
            >
              {t('login.keySaved')}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Login with recovery key mode
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-3">
          <button
            onClick={() => setMode('choose')}
            className="absolute top-4 left-4 p-2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <Key className="w-8 h-8 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl font-medium">{t('login.welcomeBack')}</CardTitle>
          <CardDescription>
            {t('login.enterKey')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="recoveryKey">{t('login.recoveryKeyLabel')}</Label>
              <div className="relative">
                <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="recoveryKey"
                  type="text"
                  placeholder={t('login.recoveryKeyPlaceholder')}
                  value={recoveryKey}
                  onChange={(e) => setRecoveryKey(e.target.value)}
                  required
                  className="pl-10 font-mono text-sm"
                />
              </div>
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={loading}
              size="lg"
            >
              {loading ? t('login.signingIn') : t('login.signIn')}
            </Button>
          </form>

          <button
            onClick={() => setMode('choose')}
            className="mt-4 text-sm text-muted-foreground hover:text-primary transition-colors block w-full text-center"
          >
            {t('login.back')}
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
