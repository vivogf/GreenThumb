import { useTranslation } from 'react-i18next';
import { Home, Plus, User } from 'lucide-react';
import { useLocation } from 'wouter';
import { cn } from '@/lib/utils';

export function BottomNavigation() {
  const { t } = useTranslation();
  const [location, setLocation] = useLocation();

  const navItems = [
    { path: '/', icon: Home, labelKey: 'nav.plants', testId: 'nav-dashboard' },
    { path: '/add-plant', icon: Plus, labelKey: 'nav.add', testId: 'nav-add-plant' },
    { path: '/profile', icon: User, labelKey: 'nav.profile', testId: 'nav-profile' },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-card border-t border-border z-50 lg:hidden">
      <div className="flex items-center justify-around h-16">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location === item.path;

          return (
            <button
              key={item.path}
              onClick={() => setLocation(item.path)}
              className={cn(
                'flex flex-col items-center justify-center flex-1 h-full gap-1 hover-elevate active-elevate-2 transition-colors',
                isActive ? 'text-primary' : 'text-muted-foreground'
              )}
              data-testid={item.testId}
            >
              <Icon className="w-6 h-6" />
              <span className="text-xs font-medium">{t(item.labelKey)}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
