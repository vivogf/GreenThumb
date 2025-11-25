import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { insertPlantSchema, type InsertPlant } from '@shared/schema';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { queryClient } from '@/lib/queryClient';
import { ArrowLeft, Upload, X } from 'lucide-react';
import { useState } from 'react';

export default function AddPlant() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const form = useForm<any>({
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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        toast({
          title: 'File too large',
          description: 'Photo must be less than 5MB',
          variant: 'destructive',
        });
        return;
      }

      setSelectedFile(file);
      form.setValue('photo_url', file.name);
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const uploadPhoto = async (file: File): Promise<string> => {
    // Store as base64 for demo - in production, use proper file storage
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const addPlantMutation = useMutation({
    mutationFn: async (plant: any) => {
      const res = await apiRequest('POST', '/api/plants', plant);
      return res.json();
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

  const onSubmit = async (data: any) => {
    console.log('Form submitted with data:', data);
    console.log('Form errors:', form.formState.errors);
    
    if (selectedFile) {
      setIsUploading(true);
      try {
        const photoUrl = await uploadPhoto(selectedFile);
        data.photo_url = photoUrl;
        console.log('Uploading plant with photo:', data);
        addPlantMutation.mutate(data);
      } catch (error: any) {
        console.error('Photo upload failed:', error);
        toast({
          title: 'Upload failed',
          description: error.message,
          variant: 'destructive',
        });
      } finally {
        setIsUploading(false);
      }
    } else {
      // Use a default placeholder image if no photo selected
      data.photo_url = 'https://images.unsplash.com/photo-1518531933037-91b2f8c3a149?w=400&h=400&fit=crop';
      console.log('Adding plant with default photo:', data);
      addPlantMutation.mutate(data);
    }
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
                    <FormLabel>Plant Photo</FormLabel>
                    <FormControl>
                      <div className="space-y-3">
                        {preview ? (
                          <div className="relative w-full bg-muted rounded-lg overflow-hidden">
                            <img
                              src={preview}
                              alt="Plant preview"
                              className="w-full h-48 object-cover"
                              data-testid="img-plant-preview"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedFile(null);
                                setPreview(null);
                                form.setValue('photo_url', '');
                              }}
                              className="absolute top-2 right-2 bg-destructive text-destructive-foreground rounded-full p-1 hover:bg-destructive/90"
                              data-testid="button-remove-photo"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-muted-foreground rounded-lg cursor-pointer hover:bg-muted transition-colors" data-testid="label-photo-upload">
                            <div className="flex flex-col items-center justify-center pt-5 pb-6">
                              <Upload className="w-8 h-8 text-muted-foreground mb-2" />
                              <p className="text-sm text-muted-foreground">Click to upload photo</p>
                              <p className="text-xs text-muted-foreground">PNG, JPG up to 5MB</p>
                            </div>
                            <input
                              type="file"
                              accept="image/*"
                              onChange={handleFileSelect}
                              className="hidden"
                              data-testid="input-photo-file"
                            />
                          </label>
                        )}
                      </div>
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
                disabled={addPlantMutation.isPending || isUploading}
                data-testid="button-submit-plant"
              >
                {isUploading ? 'Uploading Photo...' : addPlantMutation.isPending ? 'Adding Plant...' : 'Add Plant'}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
