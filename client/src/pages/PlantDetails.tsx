import { useQuery, useMutation } from '@tanstack/react-query';
import { useLocation, useParams } from 'wouter';
import type { Plant } from '@shared/schema';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { ArrowLeft, MapPin, Droplets, Calendar, Trash2, Sprout, Shovel, Scissors } from 'lucide-react';
import { format, addDays, addMonths, formatDistanceToNow } from 'date-fns';
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

export default function PlantDetails() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: plant, isLoading } = useQuery<Plant>({
    queryKey: ['/api/plants', id],
    queryFn: async () => {
      // For now, fetch all plants and filter locally
      const res = await apiRequest('GET', '/api/plants');
      const plants = await res.json();
      return plants.find((p: Plant) => p.id === id);
    },
  });

  const deletePlantMutation = useMutation({
    mutationFn: async () => {
      await apiRequest('DELETE', `/api/plants/${id}`);
    },
    onSuccess: () => {
      toast({
        title: 'Plant deleted',
        description: 'The plant has been removed from your collection.',
      });
      queryClient.invalidateQueries({ queryKey: ['/api/plants'] });
      setLocation('/');
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
      const res = await apiRequest('PATCH', `/api/plants/${id}`, {
        last_watered_date: new Date().toISOString(),
      });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: 'Plant watered!',
        description: 'Watering date updated successfully',
      });
      queryClient.invalidateQueries({ queryKey: ['/api/plants', id] });
      queryClient.invalidateQueries({ queryKey: ['/api/plants'] });
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const fertilizePlantMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('PATCH', `/api/plants/${id}`, {
        last_fertilized_date: new Date().toISOString(),
      });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: 'Plant fertilized!',
        description: 'Fertilizing date updated successfully',
      });
      queryClient.invalidateQueries({ queryKey: ['/api/plants', id] });
      queryClient.invalidateQueries({ queryKey: ['/api/plants'] });
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const repotPlantMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('PATCH', `/api/plants/${id}`, {
        last_repotted_date: new Date().toISOString(),
      });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: 'Plant repotted!',
        description: 'Repotting date updated successfully',
      });
      queryClient.invalidateQueries({ queryKey: ['/api/plants', id] });
      queryClient.invalidateQueries({ queryKey: ['/api/plants'] });
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const prunePlantMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('PATCH', `/api/plants/${id}`, {
        last_pruned_date: new Date().toISOString(),
      });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: 'Plant pruned!',
        description: 'Pruning date updated successfully',
      });
      queryClient.invalidateQueries({ queryKey: ['/api/plants', id] });
      queryClient.invalidateQueries({ queryKey: ['/api/plants'] });
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  if (isLoading) {
    return (
      <div className="p-4 pb-24 max-w-2xl mx-auto space-y-4">
        <Skeleton className="h-10 w-20" />
        <Skeleton className="aspect-video w-full rounded-lg" />
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!plant) {
    return (
      <div className="p-4 text-center">
        <p>Plant not found</p>
        <Button onClick={() => setLocation('/')} className="mt-4">
          Go Home
        </Button>
      </div>
    );
  }

  const nextWateringDate = addDays(new Date(plant.last_watered_date), plant.water_frequency_days);
  
  // Calculate next care dates
  const nextFertilizeDate = plant.fertilize_frequency_days && plant.last_fertilized_date
    ? addDays(new Date(plant.last_fertilized_date), plant.fertilize_frequency_days)
    : null;
  
  const nextRepotDate = plant.repot_frequency_months && plant.last_repotted_date
    ? addMonths(new Date(plant.last_repotted_date), plant.repot_frequency_months)
    : null;
  
  const nextPruneDate = plant.prune_frequency_months && plant.last_pruned_date
    ? addMonths(new Date(plant.last_pruned_date), plant.prune_frequency_months)
    : null;

  return (
    <div className="p-4 pb-24 max-w-2xl mx-auto space-y-4">
      <Button
        variant="ghost"
        onClick={() => setLocation('/')}
        data-testid="button-back"
      >
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back
      </Button>

      <Card className="overflow-hidden">
        <div className="aspect-video w-full overflow-hidden bg-muted">
          <img
            src={plant.photo_url}
            alt={plant.name}
            className="w-full h-full object-cover"
            data-testid="img-plant-photo"
          />
        </div>
        <CardHeader>
          <CardTitle className="text-3xl" data-testid="text-plant-name">
            {plant.name}
          </CardTitle>
          <div className="flex flex-wrap gap-2 pt-2">
            <Badge variant="secondary">
              <MapPin className="w-3 h-3 mr-1" />
              {plant.location}
            </Badge>
            <Badge variant="outline">
              Every {plant.water_frequency_days} {plant.water_frequency_days === 1 ? 'day' : 'days'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
              <Droplets className="w-5 h-5 text-primary mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium">Last Watered</p>
                <p className="text-sm text-muted-foreground" data-testid="text-last-watered">
                  {format(new Date(plant.last_watered_date), 'PPP')}
                  <span className="ml-2">
                    ({formatDistanceToNow(new Date(plant.last_watered_date), { addSuffix: true })})
                  </span>
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
              <Calendar className="w-5 h-5 text-primary mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium">Next Watering</p>
                <p className="text-sm text-muted-foreground" data-testid="text-next-watering">
                  {format(nextWateringDate, 'PPP')}
                  <span className="ml-2">
                    ({formatDistanceToNow(nextWateringDate, { addSuffix: true })})
                  </span>
                </p>
              </div>
            </div>
          </div>

          {/* Advanced Care Schedule */}
          {(nextFertilizeDate || nextRepotDate || nextPruneDate) && (
            <div className="space-y-3">
              <h3 className="font-medium">Advanced Care Schedule</h3>
              
              {nextFertilizeDate && (
                <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                  <Sprout className="w-5 h-5 text-primary mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Fertilizing</p>
                    <p className="text-sm text-muted-foreground">
                      Last: {format(new Date(plant.last_fertilized_date!), 'PPP')}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Next: {format(nextFertilizeDate, 'PPP')}
                      <span className="ml-2">
                        ({formatDistanceToNow(nextFertilizeDate, { addSuffix: true })})
                      </span>
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => fertilizePlantMutation.mutate()}
                    disabled={fertilizePlantMutation.isPending}
                    data-testid="button-fertilize"
                  >
                    {fertilizePlantMutation.isPending ? '...' : 'Fertilize'}
                  </Button>
                </div>
              )}

              {nextRepotDate && (
                <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                  <Shovel className="w-5 h-5 text-primary mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Repotting</p>
                    <p className="text-sm text-muted-foreground">
                      Last: {format(new Date(plant.last_repotted_date!), 'PPP')}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Next: {format(nextRepotDate, 'PPP')}
                      <span className="ml-2">
                        ({formatDistanceToNow(nextRepotDate, { addSuffix: true })})
                      </span>
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => repotPlantMutation.mutate()}
                    disabled={repotPlantMutation.isPending}
                    data-testid="button-repot"
                  >
                    {repotPlantMutation.isPending ? '...' : 'Repot'}
                  </Button>
                </div>
              )}

              {nextPruneDate && (
                <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                  <Scissors className="w-5 h-5 text-primary mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Pruning</p>
                    <p className="text-sm text-muted-foreground">
                      Last: {format(new Date(plant.last_pruned_date!), 'PPP')}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Next: {format(nextPruneDate, 'PPP')}
                      <span className="ml-2">
                        ({formatDistanceToNow(nextPruneDate, { addSuffix: true })})
                      </span>
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => prunePlantMutation.mutate()}
                    disabled={prunePlantMutation.isPending}
                    data-testid="button-prune"
                  >
                    {prunePlantMutation.isPending ? '...' : 'Prune'}
                  </Button>
                </div>
              )}
            </div>
          )}

          {plant.notes && (
            <div className="space-y-2">
              <h3 className="font-medium">Notes</h3>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap" data-testid="text-notes">
                {plant.notes}
              </p>
            </div>
          )}

          <div className="flex gap-3">
            <Button
              onClick={() => waterPlantMutation.mutate()}
              disabled={waterPlantMutation.isPending}
              className="flex-1"
              data-testid="button-water-plant"
            >
              {waterPlantMutation.isPending ? 'Watering...' : 'Water Plant'}
            </Button>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="icon" data-testid="button-delete-plant">
                  <Trash2 className="w-4 h-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this plant?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This action cannot be undone. This will permanently delete {plant.name} from your collection.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => deletePlantMutation.mutate()}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    data-testid="button-confirm-delete"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
