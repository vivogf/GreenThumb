import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { insertPlantSchema, type InsertPlant } from '@shared/schema';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { useToast } from '@/hooks/use-toast';
import { queryClient } from '@/lib/queryClient';
import { ArrowLeft, Upload, X, CalendarIcon } from 'lucide-react';
import { useState } from 'react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

export default function AddPlant() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t } = useTranslation();
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
      fertilize_frequency_days: undefined,
      last_fertilized_date: undefined,
      repot_frequency_months: undefined,
      last_repotted_date: undefined,
      prune_frequency_months: undefined,
      last_pruned_date: undefined,
      notes: '',
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        toast({
          title: t('addPlant.fileTooLarge'),
          description: t('addPlant.fileTooLargeHint'),
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

  const compressImage = (file: File, maxSizeKB: number = 500): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      img.onload = () => {
        // Calculate new dimensions (max 800px width/height to save space)
        const maxDimension = 800;
        let { width, height } = img;

        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = (height / width) * maxDimension;
            width = maxDimension;
          } else {
            width = (width / height) * maxDimension;
            height = maxDimension;
          }
        }

        canvas.width = width;
        canvas.height = height;
        ctx?.drawImage(img, 0, 0, width, height);

        // Start with high quality and reduce until size is acceptable
        let quality = 0.8;
        let result = canvas.toDataURL('image/jpeg', quality);

        // Reduce quality until we're under maxSizeKB
        while (result.length > maxSizeKB * 1024 * 1.37 && quality > 0.1) {
          quality -= 0.1;
          result = canvas.toDataURL('image/jpeg', quality);
        }

        resolve(result);
      };

      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  };

  const uploadPhoto = async (file: File): Promise<string> => {
    // Compress image before storing as base64
    return compressImage(file, 500);
  };

  const addPlantMutation = useMutation({
    mutationFn: async (plant: any) => {
      const res = await apiRequest('POST', '/api/plants', plant);
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: t('addPlant.success'),
        description: t('addPlant.successDescription'),
      });
      queryClient.invalidateQueries({ queryKey: ['/api/plants'] });
      setLocation('/');
    },
    onError: (error: any) => {
      toast({
        title: t('common.error'),
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
          title: t('addPlant.uploadFailed'),
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
        {t('addPlant.back')}
      </Button>

      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">{t('addPlant.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('addPlant.nameLabel')}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t('addPlant.namePlaceholder')}
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
                    <FormLabel>{t('addPlant.locationLabel')}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t('addPlant.locationPlaceholder')}
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
                    <FormLabel>{t('addPlant.photoLabel')}</FormLabel>
                    <FormControl>
                      <div className="space-y-3">
                        {preview ? (
                          <div className="relative w-full bg-muted rounded-lg overflow-hidden">
                            <img
                              src={preview}
                              alt={t('addPlant.photoLabel')}
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
                              <p className="text-sm text-muted-foreground">{t('addPlant.photoPlaceholder')}</p>
                              <p className="text-xs text-muted-foreground">{t('addPlant.photoHint')}</p>
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
                    <FormLabel>{t('addPlant.wateringLabel')}</FormLabel>
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
                name="last_watered_date"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>{t('addPlant.lastWateredLabel')}</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            className={cn(
                              "w-full pl-3 text-left font-normal",
                              !field.value && "text-muted-foreground"
                            )}
                            data-testid="button-last-watered-date"
                          >
                            {field.value ? (
                              format(new Date(field.value), "PPP")
                            ) : (
                              <span>{t('addPlant.pickDate')}</span>
                            )}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value ? new Date(field.value) : undefined}
                          onSelect={(date) => field.onChange(date?.toISOString())}
                          disabled={(date) =>
                            date > new Date() || date < new Date("1900-01-01")
                          }
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                    <FormDescription>
                      {t('addPlant.lastWateredHint')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="pt-4 border-t space-y-4">
                <h3 className="text-lg font-medium">{t('addPlant.additionalCare')}</h3>
                <p className="text-sm text-muted-foreground">{t('addPlant.additionalCareHint')}</p>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="fertilize_frequency_days"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('addPlant.fertilizing')}</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min="1"
                            placeholder={t('addPlant.fertilizePlaceholder')}
                            {...field}
                            value={field.value || ''}
                            onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
                            data-testid="input-fertilize-frequency"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="last_fertilized_date"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel>{t('addPlant.lastFertilized')}</FormLabel>
                        <Popover>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button
                                variant="outline"
                                className={cn(
                                  "pl-3 text-left font-normal",
                                  !field.value && "text-muted-foreground"
                                )}
                                data-testid="button-last-fertilized-date"
                              >
                                {field.value ? (
                                  format(new Date(field.value), "PPP")
                                ) : (
                                  <span>{t('addPlant.pickDate')}</span>
                                )}
                                <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                              mode="single"
                              selected={field.value ? new Date(field.value) : undefined}
                              onSelect={(date) => field.onChange(date?.toISOString())}
                              disabled={(date) =>
                                date > new Date() || date < new Date("1900-01-01")
                              }
                              initialFocus
                            />
                          </PopoverContent>
                        </Popover>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="repot_frequency_months"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('addPlant.repotting')}</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min="1"
                            placeholder={t('addPlant.repotPlaceholder')}
                            {...field}
                            value={field.value || ''}
                            onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
                            data-testid="input-repot-frequency"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="last_repotted_date"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel>{t('addPlant.lastRepotted')}</FormLabel>
                        <Popover>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button
                                variant="outline"
                                className={cn(
                                  "pl-3 text-left font-normal",
                                  !field.value && "text-muted-foreground"
                                )}
                                data-testid="button-last-repotted-date"
                              >
                                {field.value ? (
                                  format(new Date(field.value), "PPP")
                                ) : (
                                  <span>{t('addPlant.pickDate')}</span>
                                )}
                                <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                              mode="single"
                              selected={field.value ? new Date(field.value) : undefined}
                              onSelect={(date) => field.onChange(date?.toISOString())}
                              disabled={(date) =>
                                date > new Date() || date < new Date("1900-01-01")
                              }
                              initialFocus
                            />
                          </PopoverContent>
                        </Popover>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="prune_frequency_months"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('addPlant.pruning')}</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min="1"
                            placeholder={t('addPlant.prunePlaceholder')}
                            {...field}
                            value={field.value || ''}
                            onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
                            data-testid="input-prune-frequency"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="last_pruned_date"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel>{t('addPlant.lastPruned')}</FormLabel>
                        <Popover>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button
                                variant="outline"
                                className={cn(
                                  "pl-3 text-left font-normal",
                                  !field.value && "text-muted-foreground"
                                )}
                                data-testid="button-last-pruned-date"
                              >
                                {field.value ? (
                                  format(new Date(field.value), "PPP")
                                ) : (
                                  <span>{t('addPlant.pickDate')}</span>
                                )}
                                <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                              mode="single"
                              selected={field.value ? new Date(field.value) : undefined}
                              onSelect={(date) => field.onChange(date?.toISOString())}
                              disabled={(date) =>
                                date > new Date() || date < new Date("1900-01-01")
                              }
                              initialFocus
                            />
                          </PopoverContent>
                        </Popover>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('addPlant.notesLabel')}</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder={t('addPlant.notesPlaceholder')}
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
                {isUploading ? t('addPlant.uploading') : addPlantMutation.isPending ? t('addPlant.adding') : t('addPlant.add')}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
