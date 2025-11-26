import { useEffect, useMemo, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useMutation } from '@tanstack/react-query';
import type { Plant } from '@shared/schema';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { X, MapPin, Droplets, Calendar, Trash2, Sprout, Shovel, Scissors, ArrowLeft } from 'lucide-react';
import { format, addDays, addMonths, formatDistanceToNow, startOfDay } from 'date-fns';
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

interface PlantModalProps {
  plantId: string | null;
  isOpen: boolean;
  onClose: () => void;
  originRect?: DOMRect | null;
}

export function PlantModal({ plantId, isOpen, onClose, originRect }: PlantModalProps) {
  const { toast } = useToast();
  
  // Cache the last valid plant and rect for exit animation
  const lastPlantRef = useRef<Plant | null>(null);
  const lastRectRef = useRef<DOMRect | null>(null);

  // Use react-query to get fresh plant data that updates reactively
  const { data: plants } = useQuery<Plant[]>({
    queryKey: ['/api/plants'],
  });
  
  const currentPlant = useMemo(() => {
    if (!plantId || !plants) return null;
    return plants.find(p => p.id === plantId) || null;
  }, [plantId, plants]);

  // Update cache when we have valid data
  useEffect(() => {
    if (currentPlant) {
      lastPlantRef.current = currentPlant;
    }
    if (originRect) {
      lastRectRef.current = originRect;
    }
  }, [currentPlant, originRect]);

  // Use current plant if available, otherwise fall back to cached for exit animation
  const plant = currentPlant || lastPlantRef.current;
  const animationRect = originRect || lastRectRef.current;

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleEscape);
    }
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  const deletePlantMutation = useMutation({
    mutationFn: async () => {
      await apiRequest('DELETE', `/api/plants/${plant?.id}`);
    },
    onSuccess: () => {
      toast({
        title: 'Plant deleted',
        description: 'The plant has been removed from your collection.',
      });
      queryClient.invalidateQueries({ queryKey: ['/api/plants'] });
      onClose();
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const waterPlantMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('PATCH', `/api/plants/${plant?.id}`, {
        last_watered_date: new Date().toISOString(),
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: 'Plant watered!', description: 'Watering date updated successfully' });
      queryClient.invalidateQueries({ queryKey: ['/api/plants'] });
    },
    onError: (error: any) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const fertilizePlantMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('PATCH', `/api/plants/${plant?.id}`, {
        last_fertilized_date: new Date().toISOString(),
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: 'Plant fertilized!', description: 'Fertilizing date updated successfully' });
      queryClient.invalidateQueries({ queryKey: ['/api/plants'] });
    },
    onError: (error: any) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const repotPlantMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('PATCH', `/api/plants/${plant?.id}`, {
        last_repotted_date: new Date().toISOString(),
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: 'Plant repotted!', description: 'Repotting date updated successfully' });
      queryClient.invalidateQueries({ queryKey: ['/api/plants'] });
    },
    onError: (error: any) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const prunePlantMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('PATCH', `/api/plants/${plant?.id}`, {
        last_pruned_date: new Date().toISOString(),
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: 'Plant pruned!', description: 'Pruning date updated successfully' });
      queryClient.invalidateQueries({ queryKey: ['/api/plants'] });
    },
    onError: (error: any) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const today = startOfDay(new Date());
  
  const getPlantStatus = () => {
    if (!plant) return null;
    const lastWateredDate = startOfDay(new Date(plant.last_watered_date));
    const nextWateringDate = addDays(lastWateredDate, plant.water_frequency_days);
    const isOverdue = nextWateringDate < today;
    const isDueToday = nextWateringDate.getTime() === today.getTime();
    
    if (isOverdue) {
      const daysOverdue = Math.floor((today.getTime() - nextWateringDate.getTime()) / (1000 * 60 * 60 * 24));
      return { 
        text: `Overdue by ${daysOverdue} day${daysOverdue !== 1 ? 's' : ''}`, 
        variant: 'destructive' as const,
        lastWateredDate,
        nextWateringDate,
      };
    }
    if (isDueToday) return { text: 'Due today', variant: 'default' as const, lastWateredDate, nextWateringDate };
    return { text: `Next in ${formatDistanceToNow(nextWateringDate)}`, variant: 'secondary' as const, lastWateredDate, nextWateringDate };
  };

  const getCareStatus = (lastDate: Date | null, frequencyDays?: number | null, frequencyMonths?: number | null) => {
    if (!lastDate || (!frequencyDays && !frequencyMonths)) return null;
    const nextDate = frequencyDays 
      ? addDays(new Date(lastDate), frequencyDays)
      : addMonths(new Date(lastDate), frequencyMonths!);
    const careOverdue = startOfDay(nextDate) < today;
    const isDue = startOfDay(nextDate).getTime() === today.getTime();
    return {
      lastDate: format(new Date(lastDate), 'MMM d, yyyy'),
      nextDate: format(nextDate, 'MMM d, yyyy'),
      isOverdue: careOverdue,
      isDue,
      status: careOverdue ? 'Overdue' : isDue ? 'Due today' : `In ${formatDistanceToNow(nextDate)}`,
    };
  };

  const status = getPlantStatus();
  const fertilizeStatus = plant ? getCareStatus(
    plant.last_fertilized_date ? new Date(plant.last_fertilized_date) : null,
    plant.fertilize_frequency_days
  ) : null;
  const repotStatus = plant ? getCareStatus(
    plant.last_repotted_date ? new Date(plant.last_repotted_date) : null,
    undefined,
    plant.repot_frequency_months
  ) : null;
  const pruneStatus = plant ? getCareStatus(
    plant.last_pruned_date ? new Date(plant.last_pruned_date) : null,
    undefined,
    plant.prune_frequency_months
  ) : null;

  return (
    <AnimatePresence mode="wait">
      {isOpen && plant && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/60 z-50"
            onClick={onClose}
          />
          <motion.div
            initial={{
              opacity: 0,
              scale: 0.8,
              y: animationRect ? animationRect.top - window.innerHeight / 2 + animationRect.height / 2 : 0,
              x: animationRect ? animationRect.left - window.innerWidth / 2 + animationRect.width / 2 : 0,
            }}
            animate={{
              opacity: 1,
              scale: 1,
              y: 0,
              x: 0,
            }}
            exit={{
              opacity: 0,
              scale: 0.8,
              y: animationRect ? animationRect.top - window.innerHeight / 2 + animationRect.height / 2 : 0,
              x: animationRect ? animationRect.left - window.innerWidth / 2 + animationRect.width / 2 : 0,
            }}
            transition={{
              type: 'spring',
              damping: 25,
              stiffness: 300,
              mass: 0.8,
            }}
            className="fixed inset-4 md:inset-8 lg:inset-16 bg-background rounded-xl z-50 overflow-hidden flex flex-col shadow-2xl"
          >
            <div className="relative h-48 md:h-64 lg:h-80 overflow-hidden bg-muted flex-shrink-0">
              <motion.img
                src={plant.photo_url}
                alt={plant.name}
                className="w-full h-full object-cover"
                layoutId={`plant-image-${plant.id}`}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-4 left-4 bg-background/80 hover:bg-background"
                onClick={onClose}
                data-testid="button-close-modal"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div className="absolute bottom-4 left-4 right-4">
                <motion.h1
                  layoutId={`plant-name-${plant.id}`}
                  className="text-2xl md:text-3xl font-bold text-white mb-2"
                >
                  {plant.name}
                </motion.h1>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="secondary" className="bg-white/20 text-white border-0">
                    <MapPin className="w-3 h-3 mr-1" />
                    {plant.location}
                  </Badge>
                  {status && (
                    <Badge variant={status.variant}>
                      <Droplets className="w-3 h-3 mr-1" />
                      {status.text}
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-4 md:p-6 space-y-6">
              <div className="space-y-4">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Droplets className="w-5 h-5 text-primary" />
                  Watering
                </h2>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="space-y-1">
                    <p className="text-muted-foreground">Last watered</p>
                    <p className="font-medium">{status?.lastWateredDate && format(status.lastWateredDate, 'MMMM d, yyyy')}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-muted-foreground">Next watering</p>
                    <p className="font-medium">{status?.nextWateringDate && format(status.nextWateringDate, 'MMMM d, yyyy')}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-muted-foreground">Frequency</p>
                    <p className="font-medium">Every {plant.water_frequency_days} days</p>
                  </div>
                </div>
                <Button
                  onClick={() => waterPlantMutation.mutate()}
                  disabled={waterPlantMutation.isPending}
                  className="w-full"
                  data-testid="button-water-plant"
                >
                  <Droplets className="w-4 h-4 mr-2" />
                  {waterPlantMutation.isPending ? 'Watering...' : 'Water Now'}
                </Button>
              </div>

              {(fertilizeStatus || repotStatus || pruneStatus) && (
                <div className="space-y-4">
                  <h2 className="text-lg font-semibold">Other Care</h2>
                  <div className="grid gap-3">
                    {fertilizeStatus && (
                      <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                        <div className="flex items-center gap-3">
                          <Sprout className="w-5 h-5 text-green-600" />
                          <div>
                            <p className="font-medium text-sm">Fertilize</p>
                            <p className="text-xs text-muted-foreground">{fertilizeStatus.status}</p>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant={fertilizeStatus.isOverdue || fertilizeStatus.isDue ? 'default' : 'secondary'}
                          onClick={() => fertilizePlantMutation.mutate()}
                          disabled={fertilizePlantMutation.isPending}
                        >
                          {fertilizePlantMutation.isPending ? '...' : 'Done'}
                        </Button>
                      </div>
                    )}
                    {repotStatus && (
                      <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                        <div className="flex items-center gap-3">
                          <Shovel className="w-5 h-5 text-amber-600" />
                          <div>
                            <p className="font-medium text-sm">Repot</p>
                            <p className="text-xs text-muted-foreground">{repotStatus.status}</p>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant={repotStatus.isOverdue || repotStatus.isDue ? 'default' : 'secondary'}
                          onClick={() => repotPlantMutation.mutate()}
                          disabled={repotPlantMutation.isPending}
                        >
                          {repotPlantMutation.isPending ? '...' : 'Done'}
                        </Button>
                      </div>
                    )}
                    {pruneStatus && (
                      <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                        <div className="flex items-center gap-3">
                          <Scissors className="w-5 h-5 text-purple-600" />
                          <div>
                            <p className="font-medium text-sm">Prune</p>
                            <p className="text-xs text-muted-foreground">{pruneStatus.status}</p>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant={pruneStatus.isOverdue || pruneStatus.isDue ? 'default' : 'secondary'}
                          onClick={() => prunePlantMutation.mutate()}
                          disabled={prunePlantMutation.isPending}
                        >
                          {prunePlantMutation.isPending ? '...' : 'Done'}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {plant.notes && (
                <div className="space-y-2">
                  <h2 className="text-lg font-semibold">Notes</h2>
                  <p className="text-sm text-muted-foreground">{plant.notes}</p>
                </div>
              )}

              <div className="pt-4 border-t">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" className="w-full" data-testid="button-delete-plant">
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete Plant
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete {plant.name}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This action cannot be undone. This will permanently delete your plant and all its care history.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => deletePlantMutation.mutate()}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
