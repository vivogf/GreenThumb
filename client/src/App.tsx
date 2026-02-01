import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { BottomNavigation } from "@/components/BottomNavigation";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import AddPlant from "@/pages/AddPlant";
import PlantDetails from "@/pages/PlantDetails";
import Profile from "@/pages/Profile";
import NotFound from "@/pages/not-found";

function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/30">
      <header className="bg-card border-b border-border p-4 sticky top-0 z-40 lg:block hidden">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-2xl font-medium text-primary">GreenThumb</h1>
        </div>
      </header>
      <main className="max-w-7xl mx-auto">
        {children}
      </main>
      <BottomNavigation />
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/">
        <ProtectedRoute>
          <AuthenticatedLayout>
            <Dashboard />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/add-plant">
        <ProtectedRoute>
          <AuthenticatedLayout>
            <AddPlant />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/plant/:id">
        <ProtectedRoute>
          <AuthenticatedLayout>
            <PlantDetails />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/profile">
        <ProtectedRoute>
          <AuthenticatedLayout>
            <Profile />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AuthProvider>
            <Toaster />
            <Router />
          </AuthProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
