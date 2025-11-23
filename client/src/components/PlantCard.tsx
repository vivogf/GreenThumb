import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import type { Plant } from '@shared/schema';
import { formatDistanceToNow, addDays, isPast, isToday } from 'date-fns';
import { MapPin, Droplets } from 'lucide-react';

interface PlantCardProps {
  plant: Plant;
  onWater: (plantId: string) => void;
  isWatering: boolean;
  onClick: () => void;
}

export function PlantCard({ plant, onWater, isWatering, onClick }: PlantCardProps) {
  const nextWateringDate = addDays(new Date(plant.last_watered_date), plant.water_frequency_days);
  const isOverdue = isPast(nextWateringDate) && !isToday(nextWateringDate);
  const isDueToday = isToday(nextWateringDate);
  const needsWater = isOverdue || isDueToday;

  const getWateringStatus = () => {
    if (isOverdue) {
      const daysOverdue = Math.floor((Date.now() - nextWateringDate.getTime()) / (1000 * 60 * 60 * 24));
      return { text: `Overdue by ${daysOverdue} ${daysOverdue === 1 ? 'day' : 'days'}`, variant: 'destructive' as const };
    }
    if (isDueToday) {
      return { text: 'Due today', variant: 'default' as const };
    }
    return { 
      text: `Next watering in ${formatDistanceToNow(nextWateringDate)}`,
      variant: 'secondary' as const
    };
  };

  const status = getWateringStatus();

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
