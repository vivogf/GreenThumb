import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { insertPlantSchema, type InsertPlant } from '@shared/schema';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { queryClient } from '@/lib/queryClient';
import { ArrowLeft } from 'lucide-react';

export default function AddPlant() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();

  const form = useForm<InsertPlant>({
    resolver: zodResolver(insertPlantSchema),
    defaultValues: {
      name: '',
      location: '',
      photo_url: '',
      water_frequency_days: 7,
      last_watered_date: new Date().toISOString(),
      notes: '',
    },
  });

  const addPlantMutation = useMutation({
    mutationFn: async (plant: InsertPlant) => {
      if (!user) throw new Error('User not authenticated');
      
      const { data, error } = await supabase
        .from('plants')
        .insert([{ ...plant, user_id: user.id }])
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({
        title: 'Plant added!',
        description: 'Your new plant has been added successfully.',
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

  const onSubmit = (data: InsertPlant) => {
    addPlantMutation.mutate(data);
  };

  return (
    <div className="p-4 pb-24 max-w-2xl mx-auto">
      <Button
        variant="ghost"
        onClick={() => setLocation('/')}
        className="mb-4"
        data-testid="button-back"
      >
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back
      </Button>

      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Add New Plant</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Plant Name</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g., Monstera Deliciosa"
                        {...field}
                        data-testid="input-plant-name"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="location"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Location</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g., Living Room"
                        {...field}
                        data-testid="input-location"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="photo_url"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Photo URL</FormLabel>
                    <FormControl>
                      <Input
                        type="url"
                        placeholder="https://example.com/plant-photo.jpg"
                        {...field}
                        data-testid="input-photo-url"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="water_frequency_days"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Watering Frequency (days)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="1"
                        {...field}
                        onChange={(e) => field.onChange(parseInt(e.target.value))}
                        data-testid="input-frequency"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes (Optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Care instructions, observations, etc."
                        {...field}
                        data-testid="input-notes"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                className="w-full"
                disabled={addPlantMutation.isPending}
                data-testid="button-submit-plant"
              >
                {addPlantMutation.isPending ? 'Adding Plant...' : 'Add Plant'}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
