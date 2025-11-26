import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useLocation } from 'wouter';
import { LogOut, User, Leaf } from 'lucide-react';
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

export default function Profile() {
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const handleSignOut = async () => {
    await signOut();
    toast({
      title: 'Signed out',
      description: 'You have been signed out successfully.',
    });
    setLocation('/login');
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
