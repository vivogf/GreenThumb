import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { PlantCard, PlantCardSkeleton } from '@/components/PlantCard';
import type { Plant } from '@shared/schema';
import { addDays, isPast, isToday } from 'date-fns';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Sprout } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [wateringPlantId, setWateringPlantId] = useState<string | null>(null);

  const { data: plants, isLoading } = useQuery<Plant[]>({
    queryKey: ['/api/plants'],
  });

  const waterPlantMutation = useMutation({
    mutationFn: async (plantId: string) => {
      const res = await apiRequest('PATCH', `/api/plants/${plantId}`, {
        last_watered_date: new Date().toISOString(),
      });
      return res.json();
    },
    onMutate: async (plantId) => {
      setWateringPlantId(plantId);
      await queryClient.cancelQueries({ queryKey: ['/api/plants'] });
      
      const previousPlants = queryClient.getQueryData<Plant[]>(['/api/plants']);
      
      queryClient.setQueryData<Plant[]>(['/api/plants'], (old) =>
        old?.map((plant) =>
          plant.id === plantId
            ? { ...plant, last_watered_date: new Date().toISOString() }
            : plant
        ) || []
      );

      return { previousPlants };
    },
    onError: (error, _, context) => {
      queryClient.setQueryData(['/api/plants'], context?.previousPlants);
      toast({
        title: 'Error',
        description: 'Failed to update watering status',
        variant: 'destructive',
      });
    },
    onSuccess: () => {
      toast({
        title: 'Plant watered!',
        description: 'Watering date updated successfully',
      });
    },
    onSettled: () => {
      setWateringPlantId(null);
      queryClient.invalidateQueries({ queryKey: ['/api/plants'] });
    },
  });

  const handleWater = (plantId: string) => {
    waterPlantMutation.mutate(plantId);
  };

  const sortedPlants = plants
    ? [...plants].sort((a, b) => {
        const aNext = addDays(new Date(a.last_watered_date), a.water_frequency_days);
        const bNext = addDays(new Date(b.last_watered_date), b.water_frequency_days);
        return aNext.getTime() - bNext.getTime();
      })
    : [];

  const needsWater = sortedPlants.filter((plant) => {
    const nextWateringDate = addDays(new Date(plant.last_watered_date), plant.water_frequency_days);
    return isPast(nextWateringDate) || isToday(nextWateringDate);
  });

  const allGood = sortedPlants.filter((plant) => {
    const nextWateringDate = addDays(new Date(plant.last_watered_date), plant.water_frequency_days);
    return !isPast(nextWateringDate) && !isToday(nextWateringDate);
  });

  if (isLoading) {
    return (
      <div className="p-4 space-y-6 pb-24">
        <div className="space-y-4">
          <h2 className="text-xl font-medium">Loading plants...</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <PlantCardSkeleton key={i} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!plants || plants.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-4 text-center">
        <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-4">
          <Sprout className="w-10 h-10 text-primary" />
        </div>
        <h2 className="text-2xl font-medium mb-2">No plants yet</h2>
        <p className="text-muted-foreground mb-6 max-w-md">
          Start your plant care journey by adding your first plant. Track watering schedules and keep your green friends thriving!
        </p>
        <Button onClick={() => setLocation('/add-plant')} data-testid="button-add-first-plant">
          Add Your First Plant
        </Button>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6 pb-24">
      {needsWater.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-destructive animate-pulse"></div>
            <h2 className="text-xl font-medium text-foreground">Needs Water</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="section-needs-water">
            {needsWater.map((plant) => (
              <PlantCard
                key={plant.id}
                plant={plant}
                onWater={handleWater}
                isWatering={wateringPlantId === plant.id}
                onClick={() => setLocation(`/plant/${plant.id}`)}
              />
            ))}
          </div>
        </div>
      )}

      {allGood.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-primary"></div>
            <h2 className="text-xl font-medium text-foreground">All Good</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="section-all-good">
            {allGood.map((plant) => (
              <PlantCard
                key={plant.id}
                plant={plant}
                onWater={handleWater}
                isWatering={wateringPlantId === plant.id}
                onClick={() => setLocation(`/plant/${plant.id}`)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
