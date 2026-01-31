import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useLocation } from 'wouter';
import { LogOut, User, Leaf, Bell, BellOff, Clock, Key, Copy, RefreshCw } from 'lucide-react';
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
        title: 'Not supported',
        description: 'Push notifications are not supported in this browser.',
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
            title: 'Permission denied',
            description: 'Please enable notifications in your browser settings.',
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
            title: 'Notifications enabled',
            description: 'You will receive reminders when your plants need watering.',
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
          title: 'Notifications disabled',
          description: 'You will no longer receive watering reminders.',
        });
      }
    } catch (error) {
      console.error('Notification toggle error:', error);
      toast({
        title: 'Error',
        description: 'Failed to update notification settings.',
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
          title: 'Test sent',
          description: 'Check for a notification!',
        });
      } else {
        const data = await response.json();
        toast({
          title: 'Error',
          description: data.error || 'Failed to send test notification.',
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to send test notification.',
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
          title: 'Settings saved',
          description: 'Notification time updated successfully.',
        });
      } else {
        throw new Error('Failed to update notification time');
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to save notification time.',
        variant: 'destructive',
      });
    }
    setIsSavingTime(false);
  };

  const handleSignOut = async () => {
    await signOut();
    toast({
      title: 'Signed out',
      description: 'You have been signed out successfully.',
    });
    setLocation('/login');
  };

  const handleCopyRecoveryKey = async () => {
    if (user?.recovery_key) {
      await navigator.clipboard.writeText(user.recovery_key);
      toast({
        title: 'Copied!',
        description: 'Recovery key copied to clipboard.',
      });
    }
  };

  const handleRegenerateKey = async () => {
    setIsRegeneratingKey(true);
    try {
      await regenerateRecoveryKey();
      toast({
        title: 'Key regenerated',
        description: 'Your new recovery key has been generated. Make sure to save it!',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to regenerate recovery key.',
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
              {user?.name || 'My Profile'}
            </CardTitle>
            <CardDescription className="mt-2" data-testid="text-user-email">
              {user?.email}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2 p-4 bg-muted/50 rounded-lg">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Leaf className="w-4 h-4 text-primary" />
              <span>GreenThumb Plant Care</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Track your plants' watering schedules and keep them healthy and thriving.
            </p>
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
                    Watering Reminders
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
                Get notified when your plants need watering.
              </p>
              {notificationsEnabled && (
                <>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-primary" />
                      <Label htmlFor="notification-time" className="text-sm font-medium">
                        Notification Time
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
                        {isSavingTime ? 'Saving...' : 'Save'}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Choose when you want to receive daily reminders (your local time).
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleTestNotification}
                    className="w-full"
                    data-testid="button-test-notification"
                  >
                    Send Test Notification
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
                <Label className="text-sm font-medium">Recovery Key</Label>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowRecoveryKey(!showRecoveryKey)}
              >
                {showRecoveryKey ? 'Hide' : 'Show'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Save this key to recover your account if you lose access.
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
                    title="Copy to clipboard"
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
                  {isRegeneratingKey ? 'Generating...' : 'Generate New Key'}
                </Button>
              </div>
            )}
          </div>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" className="w-full" data-testid="button-sign-out">
                <LogOut className="w-4 h-4 mr-2" />
                Sign Out
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Sign out?</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to sign out? You'll need to sign in again to access your plants.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel data-testid="button-cancel-sign-out">Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleSignOut}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  data-testid="button-confirm-sign-out"
                >
                  Sign Out
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}
