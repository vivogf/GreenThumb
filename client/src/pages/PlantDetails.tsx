import { useQuery, useMutation } from '@tanstack/react-query';
import { useLocation, useParams } from 'wouter';
import { supabase } from '@/lib/supabase';
import type { Plant } from '@shared/schema';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { queryClient } from '@/lib/queryClient';
import { ArrowLeft, MapPin, Droplets, Calendar, Trash2 } from 'lucide-react';
import { format, addDays, formatDistanceToNow } from 'date-fns';
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
      const { data, error } = await supabase
        .from('plants')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      return data;
    },
  });

  const deletePlantMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('plants')
        .delete()
        .eq('id', id);

      if (error) throw error;
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
      const { data, error } = await supabase
        .from('plants')
        .update({ last_watered_date: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
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
