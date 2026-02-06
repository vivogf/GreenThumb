import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useLocation, useParams } from 'wouter';
import { useTranslation } from 'react-i18next';
import type { Plant } from '@shared/schema';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { ArrowLeft, MapPin, Droplets, Calendar, Trash2, Sprout, Shovel, Scissors, Settings, X, Check, Pencil } from 'lucide-react';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

export default function PlantDetails() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [isEditingSettings, setIsEditingSettings] = useState(false);
  const [editNotes, setEditNotes] = useState<string | null>(null);
  const [editName, setEditName] = useState<string | null>(null);
  
  // Edit form state
  const [waterFrequency, setWaterFrequency] = useState<number>(7);
  const [fertilizeFrequency, setFertilizeFrequency] = useState<number | null>(null);
  const [repotFrequency, setRepotFrequency] = useState<number | null>(null);
  const [pruneFrequency, setPruneFrequency] = useState<number | null>(null);

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
        title: t('plantDetails.plantDeleted'),
        description: t('plantDetails.plantDeletedDescription'),
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

  const waterPlantMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('PATCH', `/api/plants/${id}`, {
        last_watered_date: new Date().toISOString(),
      });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: t('plantDetails.plantWatered'),
        description: t('plantDetails.wateringUpdated'),
      });
      queryClient.invalidateQueries({ queryKey: ['/api/plants', id] });
      queryClient.invalidateQueries({ queryKey: ['/api/plants'] });
    },
    onError: (error: any) => {
      toast({
        title: t('common.error'),
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
        title: t('plantDetails.plantFertilized'),
        description: t('plantDetails.fertilizingUpdated'),
      });
      queryClient.invalidateQueries({ queryKey: ['/api/plants', id] });
      queryClient.invalidateQueries({ queryKey: ['/api/plants'] });
    },
    onError: (error: any) => {
      toast({
        title: t('common.error'),
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
        title: t('plantDetails.plantRepotted'),
        description: t('plantDetails.repottingUpdated'),
      });
      queryClient.invalidateQueries({ queryKey: ['/api/plants', id] });
      queryClient.invalidateQueries({ queryKey: ['/api/plants'] });
    },
    onError: (error: any) => {
      toast({
        title: t('common.error'),
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
        title: t('plantDetails.plantPruned'),
        description: t('plantDetails.pruningUpdated'),
      });
      queryClient.invalidateQueries({ queryKey: ['/api/plants', id] });
      queryClient.invalidateQueries({ queryKey: ['/api/plants'] });
    },
    onError: (error: any) => {
      toast({
        title: t('common.error'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const updateSettingsMutation = useMutation({
    mutationFn: async (data: {
      water_frequency_days?: number;
      fertilize_frequency_days?: number | null;
      repot_frequency_months?: number | null;
      prune_frequency_months?: number | null;
    }) => {
      const res = await apiRequest('PATCH', `/api/plants/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: t('plantDetails.settingsUpdated'),
        description: t('plantDetails.careScheduleUpdated'),
      });
      queryClient.invalidateQueries({ queryKey: ['/api/plants', id] });
      queryClient.invalidateQueries({ queryKey: ['/api/plants'] });
      setIsEditingSettings(false);
    },
    onError: (error: any) => {
      toast({
        title: t('common.error'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const updateNotesMutation = useMutation({
    mutationFn: async (notes: string) => {
      const res = await apiRequest('PATCH', `/api/plants/${id}`, { notes });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: t('plantDetails.notesUpdated'),
        description: t('plantDetails.notesSaved'),
      });
      queryClient.invalidateQueries({ queryKey: ['/api/plants', id] });
      queryClient.invalidateQueries({ queryKey: ['/api/plants'] });
      setEditNotes(null);
    },
    onError: (error: any) => {
      toast({
        title: t('common.error'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const updateNameMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest('PATCH', `/api/plants/${id}`, { name });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/plants', id] });
      queryClient.invalidateQueries({ queryKey: ['/api/plants'] });
      setEditName(null);
    },
    onError: (error: any) => {
      toast({
        title: t('common.error'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const openSettingsDialog = () => {
    if (plant) {
      setWaterFrequency(plant.water_frequency_days);
      setFertilizeFrequency(plant.fertilize_frequency_days || null);
      setRepotFrequency(plant.repot_frequency_months || null);
      setPruneFrequency(plant.prune_frequency_months || null);
      setIsEditingSettings(true);
    }
  };

  const handleSaveSettings = () => {
    updateSettingsMutation.mutate({
      water_frequency_days: waterFrequency,
      fertilize_frequency_days: fertilizeFrequency,
      repot_frequency_months: repotFrequency,
      prune_frequency_months: pruneFrequency,
    });
  };

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
        <p>{t('plantDetails.plantNotFound')}</p>
        <Button onClick={() => setLocation('/')} className="mt-4">
          {t('plantDetails.goHome')}
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
        {t('plantDetails.back')}
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
          {editName !== null ? (
            <div className="flex items-center gap-2">
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="text-2xl font-bold h-auto py-1"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && editName.trim()) updateNameMutation.mutate(editName.trim());
                  if (e.key === 'Escape') setEditName(null);
                }}
              />
              <Button variant="ghost" size="icon" onClick={() => editName.trim() && updateNameMutation.mutate(editName.trim())} disabled={updateNameMutation.isPending}>
                <Check className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => setEditName(null)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <CardTitle className="text-3xl flex items-center gap-2" data-testid="text-plant-name">
              {plant.name}
              <Button variant="ghost" size="icon" onClick={() => setEditName(plant.name)} className="h-8 w-8">
                <Pencil className="w-4 h-4" />
              </Button>
            </CardTitle>
          )}
          <div className="flex flex-wrap gap-2 pt-2">
            <Badge variant="secondary">
              <MapPin className="w-3 h-3 mr-1" />
              {plant.location}
            </Badge>
            <Badge variant="outline">
              {plant.water_frequency_days === 1
                ? t('plantDetails.everyDay', { count: plant.water_frequency_days })
                : t('plantDetails.everyDays', { count: plant.water_frequency_days })}
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              onClick={openSettingsDialog}
              className="ml-auto"
              data-testid="button-edit-settings"
            >
              <Settings className="w-4 h-4 mr-1" />
              {t('plantDetails.settings')}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
              <Droplets className="w-5 h-5 text-primary mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium">{t('plantDetails.lastWatered')}</p>
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
                <p className="text-sm font-medium">{t('plantDetails.nextWatering')}</p>
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
              <h3 className="font-medium">{t('plantDetails.advancedCare')}</h3>

              {nextFertilizeDate && (
                <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                  <Sprout className="w-5 h-5 text-primary mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{t('plantDetails.fertilizing')}</p>
                    <p className="text-sm text-muted-foreground">
                      {t('plantDetails.last', { date: format(new Date(plant.last_fertilized_date!), 'PPP') })}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t('plantDetails.next', { date: format(nextFertilizeDate, 'PPP') })}
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
                    {fertilizePlantMutation.isPending ? '...' : t('plantDetails.fertilize')}
                  </Button>
                </div>
              )}

              {nextRepotDate && (
                <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                  <Shovel className="w-5 h-5 text-primary mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{t('plantDetails.repotting')}</p>
                    <p className="text-sm text-muted-foreground">
                      {t('plantDetails.last', { date: format(new Date(plant.last_repotted_date!), 'PPP') })}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t('plantDetails.next', { date: format(nextRepotDate, 'PPP') })}
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
                    {repotPlantMutation.isPending ? '...' : t('plantDetails.repot')}
                  </Button>
                </div>
              )}

              {nextPruneDate && (
                <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                  <Scissors className="w-5 h-5 text-primary mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{t('plantDetails.pruning')}</p>
                    <p className="text-sm text-muted-foreground">
                      {t('plantDetails.last', { date: format(new Date(plant.last_pruned_date!), 'PPP') })}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t('plantDetails.next', { date: format(nextPruneDate, 'PPP') })}
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
                    {prunePlantMutation.isPending ? '...' : t('plantDetails.prune')}
                  </Button>
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-medium">{t('plantDetails.notes')}</h3>
              {editNotes === null ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditNotes(plant.notes || '')}
                  data-testid="button-edit-notes"
                >
                  {plant.notes ? t('plantDetails.edit') : t('plantDetails.addNotes')}
                </Button>
              ) : (
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditNotes(null)}
                    data-testid="button-cancel-notes"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => updateNotesMutation.mutate(editNotes)}
                    disabled={updateNotesMutation.isPending}
                    data-testid="button-save-notes"
                  >
                    <Check className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </div>
            {editNotes !== null ? (
              <Textarea
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder={t('plantDetails.notesPlaceholder')}
                className="min-h-[100px]"
                data-testid="input-notes"
              />
            ) : plant.notes ? (
              <p className="text-sm text-muted-foreground whitespace-pre-wrap" data-testid="text-notes">
                {plant.notes}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground italic">{t('plantDetails.noNotes')}</p>
            )}
          </div>

          <div className="flex gap-3">
            <Button
              onClick={() => waterPlantMutation.mutate()}
              disabled={waterPlantMutation.isPending}
              className="flex-1"
              data-testid="button-water-plant"
            >
              {waterPlantMutation.isPending ? t('plantDetails.watering') : t('plantDetails.waterPlant')}
            </Button>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="icon" data-testid="button-delete-plant">
                  <Trash2 className="w-4 h-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('plantDetails.deleteTitle')}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t('plantDetails.deleteDescription', { name: plant.name })}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel data-testid="button-cancel-delete">{t('plantDetails.cancel')}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => deletePlantMutation.mutate()}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    data-testid="button-confirm-delete"
                  >
                    {t('plantDetails.delete')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isEditingSettings} onOpenChange={setIsEditingSettings}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{t('plantDetails.careSettings')}</DialogTitle>
            <DialogDescription>
              {t('plantDetails.careSettingsDescription', { name: plant.name })}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="water-frequency" className="flex items-center gap-2">
                <Droplets className="w-4 h-4 text-primary" />
                {t('plantDetails.wateringFrequency')}
              </Label>
              <Input
                id="water-frequency"
                type="number"
                min="1"
                max="365"
                value={waterFrequency}
                onChange={(e) => setWaterFrequency(parseInt(e.target.value) || 7)}
                data-testid="input-water-frequency"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="fertilize-frequency" className="flex items-center gap-2">
                <Sprout className="w-4 h-4 text-green-600" />
                {t('plantDetails.fertilizingFrequency')}
              </Label>
              <Input
                id="fertilize-frequency"
                type="number"
                min="0"
                max="365"
                value={fertilizeFrequency || ''}
                onChange={(e) => setFertilizeFrequency(e.target.value ? parseInt(e.target.value) : null)}
                placeholder={t('plantDetails.leaveEmpty')}
                data-testid="input-fertilize-frequency"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="repot-frequency" className="flex items-center gap-2">
                <Shovel className="w-4 h-4 text-amber-600" />
                {t('plantDetails.repottingFrequency')}
              </Label>
              <Input
                id="repot-frequency"
                type="number"
                min="0"
                max="60"
                value={repotFrequency || ''}
                onChange={(e) => setRepotFrequency(e.target.value ? parseInt(e.target.value) : null)}
                placeholder={t('plantDetails.leaveEmpty')}
                data-testid="input-repot-frequency"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="prune-frequency" className="flex items-center gap-2">
                <Scissors className="w-4 h-4 text-purple-600" />
                {t('plantDetails.pruningFrequency')}
              </Label>
              <Input
                id="prune-frequency"
                type="number"
                min="0"
                max="60"
                value={pruneFrequency || ''}
                onChange={(e) => setPruneFrequency(e.target.value ? parseInt(e.target.value) : null)}
                placeholder={t('plantDetails.leaveEmpty')}
                data-testid="input-prune-frequency"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditingSettings(false)}>
              {t('plantDetails.cancel')}
            </Button>
            <Button
              onClick={handleSaveSettings}
              disabled={updateSettingsMutation.isPending}
              data-testid="button-save-settings"
            >
              {updateSettingsMutation.isPending ? t('plantDetails.saving') : t('plantDetails.saveChanges')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
