import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import type { Plant } from '@shared/schema';
import { formatDistanceToNow, addDays, isPast, isToday, startOfDay } from 'date-fns';
import { MapPin, Droplets } from 'lucide-react';

export type LayoutMode = 'card' | 'compact';

interface PlantCardProps {
  plant: Plant;
  onWater: (plantId: string) => void;
  isWatering: boolean;
  onClick: () => void;
  layout?: LayoutMode;
}

export function PlantCard({ plant, onWater, isWatering, onClick, layout = 'card' }: PlantCardProps) {
  const lastWateredDate = startOfDay(new Date(plant.last_watered_date));
  const nextWateringDate = addDays(lastWateredDate, plant.water_frequency_days);
  const today = startOfDay(new Date());
  const isOverdue = nextWateringDate < today;
  const isDueToday = nextWateringDate.getTime() === today.getTime();
  const needsWater = isOverdue || isDueToday;

  const getWateringStatus = () => {
    if (isOverdue) {
      const daysOverdue = Math.floor((today.getTime() - nextWateringDate.getTime()) / (1000 * 60 * 60 * 24));
      return { text: `Overdue by ${daysOverdue} ${daysOverdue === 1 ? 'day' : 'days'}`, shortText: `-${daysOverdue}d`, variant: 'destructive' as const };
    }
    if (isDueToday) {
      return { text: 'Due today', shortText: 'Today', variant: 'default' as const };
    }
    const daysUntil = Math.ceil((nextWateringDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return { 
      text: `Next watering in ${formatDistanceToNow(nextWateringDate)}`,
      shortText: `${daysUntil}d`,
      variant: 'secondary' as const
    };
  };

  const status = getWateringStatus();

  if (layout === 'compact') {
    return (
      <Card className="overflow-hidden hover-elevate cursor-pointer transition-all" onClick={onClick}>
        <div className="flex items-center gap-3 p-3">
          <div className="relative w-14 h-14 flex-shrink-0 rounded-md overflow-hidden bg-muted">
            <img
              src={plant.photo_url}
              alt={plant.name}
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 24 24" fill="none" stroke="%232E7D32" stroke-width="2"%3E%3Cpath d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"%3E%3C/path%3E%3Cpath d="M7.5 12H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-2.5"%3E%3C/path%3E%3C/svg%3E';
              }}
            />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-medium text-foreground truncate" data-testid={`text-plant-name-${plant.id}`}>
              {plant.name}
            </h3>
            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
              <MapPin className="w-3 h-3" />
              <span className="truncate">{plant.location}</span>
            </div>
          </div>
          <Badge variant={status.variant} className="text-xs flex-shrink-0" data-testid={`text-status-${plant.id}`}>
            <Droplets className="w-3 h-3 mr-1" />
            {status.shortText}
          </Badge>
          <Button
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onWater(plant.id);
            }}
            disabled={isWatering}
            variant={needsWater ? 'default' : 'secondary'}
            data-testid={`button-water-${plant.id}`}
          >
            {isWatering ? '...' : 'Water'}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden hover-elevate cursor-pointer transition-all" onClick={onClick}>
      <div className="relative aspect-video overflow-hidden bg-muted">
        <img
          src={plant.photo_url}
          alt={plant.name}
          className="w-full h-full object-cover"
          onError={(e) => {
            (e.target as HTMLImageElement).src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 24 24" fill="none" stroke="%232E7D32" stroke-width="2"%3E%3Cpath d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"%3E%3C/path%3E%3Cpath d="M7.5 12H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-2.5"%3E%3C/path%3E%3C/svg%3E';
          }}
        />
      </div>
      <CardContent className="p-4 space-y-3">
        <div className="space-y-2">
          <h3 className="text-lg font-medium text-foreground" data-testid={`text-plant-name-${plant.id}`}>
            {plant.name}
          </h3>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs">
              <MapPin className="w-3 h-3 mr-1" />
              {plant.location}
            </Badge>
          </div>
          <Badge variant={status.variant} className="text-xs" data-testid={`text-status-${plant.id}`}>
            <Droplets className="w-3 h-3 mr-1" />
            {status.text}
          </Badge>
        </div>
        {plant.notes && (
          <p className="text-sm text-muted-foreground line-clamp-2">
            {plant.notes}
          </p>
        )}
        <Button
          onClick={(e) => {
            e.stopPropagation();
            onWater(plant.id);
          }}
          disabled={isWatering}
          className="w-full"
          variant={needsWater ? 'default' : 'secondary'}
          data-testid={`button-water-${plant.id}`}
        >
          {isWatering ? 'Watering...' : 'Water Plant'}
        </Button>
      </CardContent>
    </Card>
  );
}

export function PlantCardSkeleton() {
  return (
    <Card className="overflow-hidden">
      <Skeleton className="aspect-video w-full" />
      <CardContent className="p-4 space-y-3">
        <Skeleton className="h-6 w-3/4" />
        <div className="flex gap-2">
          <Skeleton className="h-5 w-20" />
        </div>
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-10 w-full" />
      </CardContent>
    </Card>
  );
}
