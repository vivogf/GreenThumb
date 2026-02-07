import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useLocation } from 'wouter';
import { LogOut, User, Leaf, Bell, BellOff, Clock, Key, Copy, RefreshCw, Globe } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export default function Profile() {
  const { t, i18n } = useTranslation();
  const { user, signOut, updateUser, regenerateRecoveryKey } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [notificationsSupported, setNotificationsSupported] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [notificationTime, setNotificationTime] = useState(user?.notification_time || '09:00');
  const [isSavingTime, setIsSavingTime] = useState(false);
  const [showRecoveryKey, setShowRecoveryKey] = useState(false);
  const [isRegeneratingKey, setIsRegeneratingKey] = useState(false);

  const currentLang = i18n.language?.startsWith('ru') ? 'ru' : 'en';

  const changeLanguage = (lang: string) => {
    i18n.changeLanguage(lang);
  };

  useEffect(() => {
    const checkNotificationSupport = async () => {
      if ('serviceWorker' in navigator && 'PushManager' in window) {
        setNotificationsSupported(true);

        try {
          const response = await fetch('/api/push/subscription', {
            credentials: 'include',
          });
          const data = await response.json();
          setNotificationsEnabled(data.subscribed);
        } catch (error) {
          console.error('Error checking subscription:', error);
        }
      }
      setIsLoading(false);
    };

    checkNotificationSupport();
  }, []);

  const handleNotificationToggle = async (enabled: boolean) => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      toast({
        title: t('common.error'),
        description: t('profile.pushNotSupported'),
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);

    try {
      if (enabled) {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          toast({
            title: t('common.error'),
            description: t('profile.permissionDenied'),
            variant: 'destructive',
          });
          setIsLoading(false);
          return;
        }

        const registration = await navigator.serviceWorker.register('/sw.js');
        await navigator.serviceWorker.ready;

        const vapidResponse = await fetch('/api/push/vapid-public-key');
        const { publicKey } = await vapidResponse.json();

        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });

        const response = await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(subscription.toJSON()),
        });

        if (response.ok) {
          setNotificationsEnabled(true);
          toast({
            title: t('profile.notificationsEnabled'),
            description: t('profile.notificationsEnabledHint'),
          });
        }
      } else {
        const registration = await navigator.serviceWorker.getRegistration();
        if (registration) {
          const subscription = await registration.pushManager.getSubscription();
          if (subscription) {
            await subscription.unsubscribe();
          }
        }

        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          credentials: 'include',
        });

        setNotificationsEnabled(false);
        toast({
          title: t('profile.notificationsDisabled'),
          description: t('profile.notificationsDisabledHint'),
        });
      }
    } catch (error) {
      console.error('Notification toggle error:', error);
      toast({
        title: t('common.error'),
        description: t('profile.notificationError'),
        variant: 'destructive',
      });
    }

    setIsLoading(false);
  };

  const handleTestNotification = async () => {
    try {
      const response = await fetch('/api/push/test', {
        method: 'POST',
        credentials: 'include',
      });

      if (response.ok) {
        toast({
          title: t('profile.testSent'),
          description: t('profile.testSentHint'),
        });
      } else {
        const data = await response.json().catch(() => ({}));
        if (data.error === 'subscription_expired' || data.error === 'no_subscription') {
          setNotificationsEnabled(false);
          toast({
            title: t('common.error'),
            description: t('profile.subscriptionExpired'),
            variant: 'destructive',
          });
        } else {
          toast({
            title: t('common.error'),
            description: t('profile.testFailed'),
            variant: 'destructive',
          });
        }
      }
    } catch (error) {
      toast({
        title: t('common.error'),
        description: t('profile.testFailed'),
        variant: 'destructive',
      });
    }
  };

  const handleSaveNotificationTime = async () => {
    setIsSavingTime(true);
    try {
      const response = await fetch('/api/auth/update-notification-time', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ notification_time: notificationTime }),
      });

      if (response.ok) {
        const data = await response.json();
        updateUser(data.user);
        toast({
          title: t('profile.settingsSaved'),
          description: t('profile.notificationTimeUpdated'),
        });
      } else {
        throw new Error('Failed to update notification time');
      }
    } catch (error) {
      toast({
        title: t('common.error'),
        description: t('common.error'),
        variant: 'destructive',
      });
    }
    setIsSavingTime(false);
  };

  const handleSignOut = async () => {
    await signOut();
    toast({
      title: t('profile.signedOut'),
      description: t('profile.signedOutSuccess'),
    });
    setLocation('/login');
  };

  const handleCopyRecoveryKey = async () => {
    if (user?.recovery_key) {
      await navigator.clipboard.writeText(user.recovery_key);
      toast({
        title: t('profile.copied'),
        description: t('profile.copiedHint'),
      });
    }
  };

  const handleRegenerateKey = async () => {
    setIsRegeneratingKey(true);
    try {
      await regenerateRecoveryKey();
      toast({
        title: t('profile.keyRegenerated'),
        description: t('profile.keyRegeneratedHint'),
      });
    } catch (error) {
      toast({
        title: t('common.error'),
        description: t('common.error'),
        variant: 'destructive',
      });
    }
    setIsRegeneratingKey(false);
  };

  return (
    <div className="p-4 pb-24 max-w-2xl mx-auto space-y-4">
      <Card>
        <CardHeader className="text-center space-y-4">
          <div className="flex justify-center">
            <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
              <User className="w-10 h-10 text-primary" />
            </div>
          </div>
          <div>
            <CardTitle className="text-2xl" data-testid="text-user-name">
              {user?.name || t('profile.title')}
            </CardTitle>
            <CardDescription className="mt-2">
              {t('profile.anonymous')}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2 p-4 bg-muted/50 rounded-lg">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Leaf className="w-4 h-4 text-primary" />
              <span>{t('profile.appDescription')}</span>
            </div>
            <p className="text-sm text-muted-foreground">
              {t('profile.appTagline')}
            </p>
          </div>

          {/* Language Switcher */}
          <div className="space-y-3 p-4 bg-muted/50 rounded-lg">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-primary" />
                <Label className="text-sm font-medium">{t('profile.language')}</Label>
              </div>
              <div className="flex gap-1">
                <Button
                  variant={currentLang === 'ru' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => changeLanguage('ru')}
                  className="px-3 font-medium"
                >
                  RU
                </Button>
                <Button
                  variant={currentLang === 'en' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => changeLanguage('en')}
                  className="px-3 font-medium"
                >
                  EN
                </Button>
              </div>
            </div>
          </div>

          {notificationsSupported && (
            <div className="space-y-3 p-4 bg-muted/50 rounded-lg">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  {notificationsEnabled ? (
                    <Bell className="w-4 h-4 text-primary" />
                  ) : (
                    <BellOff className="w-4 h-4 text-muted-foreground" />
                  )}
                  <Label htmlFor="notifications" className="text-sm font-medium">
                    {t('profile.notifications')}
                  </Label>
                </div>
                <Switch
                  id="notifications"
                  checked={notificationsEnabled}
                  onCheckedChange={handleNotificationToggle}
                  disabled={isLoading}
                  data-testid="switch-notifications"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {t('profile.notificationsHint')}
              </p>
              {notificationsEnabled && (
                <>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-primary" />
                      <Label htmlFor="notification-time" className="text-sm font-medium">
                        {t('profile.notificationTime')}
                      </Label>
                    </div>
                    <div className="flex gap-2">
                      <Input
                        id="notification-time"
                        type="time"
                        value={notificationTime}
                        onChange={(e) => setNotificationTime(e.target.value)}
                        className="flex-1"
                        data-testid="input-notification-time"
                      />
                      <Button
                        size="sm"
                        onClick={handleSaveNotificationTime}
                        disabled={isSavingTime}
                        data-testid="button-save-notification-time"
                      >
                        {isSavingTime ? t('profile.saving') : t('profile.save')}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t('profile.notificationTimeHint')}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleTestNotification}
                    className="w-full"
                    data-testid="button-test-notification"
                  >
                    {t('profile.testNotification')}
                  </Button>
                </>
              )}
            </div>
          )}

          {/* Recovery Key Section */}
          <div className="space-y-3 p-4 bg-muted/50 rounded-lg">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4 text-primary" />
                <Label className="text-sm font-medium">{t('profile.recoveryKey')}</Label>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowRecoveryKey(!showRecoveryKey)}
              >
                {showRecoveryKey ? t('profile.hide') : t('profile.show')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('profile.recoveryKeyHint')}
            </p>
            {showRecoveryKey && user?.recovery_key && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <code className="flex-1 p-2 bg-background rounded text-xs font-mono break-all border">
                    {user.recovery_key}
                  </code>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleCopyRecoveryKey}
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRegenerateKey}
                  disabled={isRegeneratingKey}
                  className="w-full"
                >
                  <RefreshCw className={`w-4 h-4 mr-2 ${isRegeneratingKey ? 'animate-spin' : ''}`} />
                  {isRegeneratingKey ? t('profile.generating') : t('profile.generateNewKey')}
                </Button>
              </div>
            )}
          </div>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" className="w-full" data-testid="button-sign-out">
                <LogOut className="w-4 h-4 mr-2" />
                {t('profile.signOut')}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('profile.signOutConfirm')}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t('profile.signOutWarning')}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel data-testid="button-cancel-sign-out">{t('common.cancel')}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleSignOut}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  data-testid="button-confirm-sign-out"
                >
                  {t('profile.signOut')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}
