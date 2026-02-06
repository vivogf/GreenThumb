import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import type { Plant } from '@shared/schema';
import { addDays, startOfDay } from 'date-fns';
import { MapPin, Droplets, Heart, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useState, useRef } from 'react';

export type LayoutMode = 'card' | 'compact';

interface PlantCardProps {
  plant: Plant;
  onWater: (plantId: string) => void;
  isWatering: boolean;
  onClick: () => void;
  layout?: LayoutMode;
}

interface WaterButtonProps {
  onWater: () => void;
  isWatering: boolean;
  needsWater: boolean;
  fullWidth?: boolean;
  compact?: boolean;
}

function WaterButton({ onWater, isWatering, needsWater, fullWidth, compact }: WaterButtonProps) {
  const { t } = useTranslation();
  const [hearts, setHearts] = useState<{ id: number; x: number; initialVelocity: number; rotation: number; size: number }[]>([]);
  const [heartIdCounter, setHeartIdCounter] = useState(0);
  const [justWatered, setJustWatered] = useState(false);
  const waterTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const handleWater = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (justWatered) return;

    const heartCount = 8 + Math.floor(Math.random() * 5);
    const newHearts = Array.from({ length: heartCount }, (_, i) => ({
      id: heartIdCounter + i,
      x: Math.random() * 80 - 40,
      initialVelocity: 40 + Math.random() * 30,
      rotation: Math.random() * 60 - 30,
      size: [4, 5, 5, 6][Math.floor(Math.random() * 4)],
    }));

    setHearts(prev => [...prev, ...newHearts]);
    setHeartIdCounter(prev => prev + heartCount);
    setJustWatered(true);

    setTimeout(() => {
      setHearts(prev => prev.filter(h => !newHearts.find(nh => nh.id === h.id)));
    }, 2200);

    waterTimeoutRef.current = setTimeout(() => {
      onWater();
      setJustWatered(false);
    }, 1500);
  };

  return (
    <div className="relative inline-block">
      <Button
        onClick={handleWater}
        disabled={isWatering || justWatered}
        className={fullWidth ? 'w-full' : ''}
        size={compact ? 'sm' : 'default'}
        variant={needsWater && !justWatered ? 'default' : 'secondary'}
        data-testid="button-water"
      >
        {justWatered ? <Check className="w-4 h-4" /> : isWatering ? '...' : t('plant.water')}
      </Button>
      <AnimatePresence>
        {hearts.map(heart => (
          <motion.div
            key={heart.id}
            initial={{ opacity: 1, y: 0, x: heart.x * 0.3, scale: 0.3, rotate: 0 }}
            animate={{
              opacity: [1, 1, 0.9, 0.5, 0],
              y: [0, -heart.initialVelocity, -heart.initialVelocity * 1.1, -heart.initialVelocity * 0.5, 10],
              x: [heart.x * 0.3, heart.x * 0.8, heart.x, heart.x * 1.1, heart.x * 1.2],
              scale: [0.3, 1.1, 1, 0.7, 0.3],
              rotate: [0, heart.rotation * 0.5, heart.rotation, heart.rotation * 1.2, heart.rotation * 1.5]
            }}
            exit={{ opacity: 0 }}
            transition={{
              duration: 2,
              times: [0, 0.3, 0.5, 0.75, 1],
              ease: "easeOut",
            }}
            className="absolute top-0 left-1/2 pointer-events-none"
            style={{ marginLeft: `-${heart.size * 2}px` }}
          >
            <Heart className={`w-${heart.size} h-${heart.size} fill-green-500 text-green-500 drop-shadow-md`} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function PlantCard({ plant, onWater, isWatering, onClick, layout = 'card' }: PlantCardProps) {
  const { t } = useTranslation();
  const lastWateredDate = startOfDay(new Date(plant.last_watered_date));
  const nextWateringDate = addDays(lastWateredDate, plant.water_frequency_days);
  const today = startOfDay(new Date());
  const isOverdue = nextWateringDate < today;
  const isDueToday = nextWateringDate.getTime() === today.getTime();
  const needsWater = isOverdue || isDueToday;

  const getWateringStatus = () => {
    if (isOverdue) {
      const daysOverdue = Math.floor((today.getTime() - nextWateringDate.getTime()) / (1000 * 60 * 60 * 24));
      return {
        text: t('plant.overdue', { count: daysOverdue }),
        shortText: `-${daysOverdue}`,
        variant: 'destructive' as const
      };
    }
    if (isDueToday) {
      return { text: t('plant.waterToday'), shortText: t('plantDetails.today'), variant: 'default' as const };
    }
    const daysUntil = Math.ceil((nextWateringDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return {
      text: t('plant.daysLeft', { count: daysUntil }),
      shortText: `${daysUntil}`,
      variant: 'secondary' as const
    };
  };

  const status = getWateringStatus();

  const handleClick = () => {
    onClick();
  };

  if (layout === 'compact') {
    return (
      <Card className="overflow-hidden hover-elevate cursor-pointer transition-all" onClick={handleClick}>
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
          <WaterButton
            onWater={() => onWater(plant.id)}
            isWatering={isWatering}
            needsWater={needsWater}
            compact
          />
        </div>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden hover-elevate cursor-pointer transition-all" onClick={handleClick}>
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
      <CardContent className="p-3 space-y-2">
        <h3 className="text-base font-medium text-foreground truncate" data-testid={`text-plant-name-${plant.id}`}>
          {plant.name}
        </h3>
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-col gap-1 min-w-0 flex-1">
            <Badge variant="secondary" className="text-xs w-fit">
              <MapPin className="w-3 h-3 mr-1" />
              {plant.location}
            </Badge>
            <Badge variant={status.variant} className="text-xs w-fit" data-testid={`text-status-${plant.id}`}>
              <Droplets className="w-3 h-3 mr-1" />
              {status.text}
            </Badge>
          </div>
          <WaterButton
            onWater={() => onWater(plant.id)}
            isWatering={isWatering}
            needsWater={needsWater}
          />
        </div>
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
