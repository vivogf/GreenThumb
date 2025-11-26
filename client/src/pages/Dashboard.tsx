import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { PlantCard, PlantCardSkeleton, type LayoutMode } from '@/components/PlantCard';
import type { Plant } from '@shared/schema';
import { addDays, startOfDay } from 'date-fns';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Sprout, LayoutGrid, LayoutList, Search, Droplets, CalendarClock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type SortOption = 'watering' | 'name' | 'location' | 'date';

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [wateringPlantId, setWateringPlantId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('watering');
  const [layout, setLayout] = useState<LayoutMode>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('plantLayoutMode') as LayoutMode) || 'card';
    }
    return 'card';
  });

  useEffect(() => {
    localStorage.setItem('plantLayoutMode', layout);
  }, [layout]);

  const toggleLayout = () => {
    setLayout(prev => prev === 'card' ? 'compact' : 'card');
  };

  const handlePlantClick = (plant: Plant) => {
    setLocation(`/plant/${plant.id}`);
  };

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

  const waterAllMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/plants/water-all', {});
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: 'All plants watered!',
        description: `${data.count} plant(s) watered today`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/plants'] });
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to water all plants',
        variant: 'destructive',
      });
    },
  });

  const postponeAllMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/plants/postpone-all', {});
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: 'Watering postponed!',
        description: `${data.count} plant(s) postponed to tomorrow`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/plants'] });
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to postpone watering',
        variant: 'destructive',
      });
    },
  });

  const handleWater = (plantId: string) => {
    waterPlantMutation.mutate(plantId);
  };

  const today = startOfDay(new Date());
  
  // Filter by search query
  const filteredPlants = plants
    ? plants.filter((plant) =>
        plant.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : [];

  // Sort plants based on selected option
  const sortedPlants = [...filteredPlants].sort((a, b) => {
    switch (sortBy) {
      case 'watering': {
        const aNext = addDays(startOfDay(new Date(a.last_watered_date)), a.water_frequency_days);
        const bNext = addDays(startOfDay(new Date(b.last_watered_date)), b.water_frequency_days);
        return aNext.getTime() - bNext.getTime();
      }
      case 'name':
        return a.name.localeCompare(b.name);
      case 'location':
        return a.location.localeCompare(b.location);
      case 'date': {
        const aDate = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bDate = b.created_at ? new Date(b.created_at).getTime() : 0;
        return bDate - aDate; // Newest first
      }
      default:
        return 0;
    }
  });

  const needsWater = sortedPlants.filter((plant) => {
    const lastWatered = startOfDay(new Date(plant.last_watered_date));
    const nextWateringDate = addDays(lastWatered, plant.water_frequency_days);
    return nextWateringDate <= today;
  });

  const allGood = sortedPlants.filter((plant) => {
    const lastWatered = startOfDay(new Date(plant.last_watered_date));
    const nextWateringDate = addDays(lastWatered, plant.water_frequency_days);
    return nextWateringDate > today;
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
      <div className="space-y-3">
        <div className="flex gap-2 items-center flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search plants..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              data-testid="input-search-plants"
            />
          </div>
          <Select value={sortBy} onValueChange={(value: SortOption) => setSortBy(value)}>
            <SelectTrigger className="w-[180px]" data-testid="select-sort-by">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="watering">Watering needed</SelectItem>
              <SelectItem value="name">Name (A-Z)</SelectItem>
              <SelectItem value="location">Location</SelectItem>
              <SelectItem value="date">Date added</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleLayout}
            data-testid="button-toggle-layout"
            title={layout === 'card' ? 'Switch to compact view' : 'Switch to card view'}
          >
            {layout === 'card' ? (
              <LayoutList className="h-5 w-5" />
            ) : (
              <LayoutGrid className="h-5 w-5" />
            )}
          </Button>
        </div>

        {needsWater.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            <Button
              onClick={() => waterAllMutation.mutate()}
              disabled={waterAllMutation.isPending}
              variant="default"
              size="sm"
              data-testid="button-water-all"
            >
              <Droplets className="w-4 h-4 mr-2" />
              {waterAllMutation.isPending ? 'Watering...' : 'Water All Today'}
            </Button>
            <Button
              onClick={() => postponeAllMutation.mutate()}
              disabled={postponeAllMutation.isPending}
              variant="secondary"
              size="sm"
              data-testid="button-postpone-all"
            >
              <CalendarClock className="w-4 h-4 mr-2" />
              {postponeAllMutation.isPending ? 'Postponing...' : 'Postpone to Tomorrow'}
            </Button>
          </div>
        )}
      </div>

      {needsWater.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-destructive animate-pulse"></div>
            <h2 className="text-xl font-medium text-foreground">Needs Water</h2>
          </div>
          <div className={layout === 'compact' ? 'space-y-2' : 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4'} data-testid="section-needs-water">
            {needsWater.map((plant) => (
              <PlantCard
                key={plant.id}
                plant={plant}
                onWater={handleWater}
                isWatering={wateringPlantId === plant.id}
                onClick={() => handlePlantClick(plant)}
                layout={layout}
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
          <div className={layout === 'compact' ? 'space-y-2' : 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4'} data-testid="section-all-good">
            {allGood.map((plant) => (
              <PlantCard
                key={plant.id}
                plant={plant}
                onWater={handleWater}
                isWatering={wateringPlantId === plant.id}
                onClick={() => handlePlantClick(plant)}
                layout={layout}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
